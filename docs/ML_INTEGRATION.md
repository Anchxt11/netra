# Model 1 (ATDE) in the live pipeline

Written 2026-10-07 (build plan B1), from `ml/model1/` at `main` b9eee61 (VERSION 1.0.0).

## Loading and parity: done
- `ml/atde/predict.py` loads the bundle once. `ATDE().score(rows)` returns, per row: `anomaly_score`, `is_anomaly`, `family` (or `UNKNOWN`), `probability`, and the top 3 SHAP `reasons`. Features come only from the bundle's own `preprocess.py`; nothing is re-implemented.
- **Parity:** `tests/test_atde.py` passes.
  - All 100 rows of `samples.jsonl` (50 AWS VPC, 50 Cisco ASA) reproduce their stored `anomaly_score` exactly, to 6 decimals, and their `is_anomaly` verdict.
  - Every feature that needs no history is rebuilt from the raw message and matches.
  - The rolling counts (`cnt_`, `nports_`, `ndst_`) need the 600 s (AWS) or 3600 s (Cisco) of rows before each sample. The samples file doesn't include them, so for those the test uses the stored values. Checking them from scratch needs `data/interim/pool_split.parquet`, which is on the ML laptop, not in the repo.
- **Versions:** the models were saved with scikit-learn 1.9.1, numpy 2.5.3, pandas 3.0.6, xgboost 3.4.1 and shap 0.52.0 (root `requirements.txt`). These need Python 3.11 or later. The test skips itself when they are missing.
- **Speed** (this laptop, 12 cores, 20,000 AWS rows; `python -m ml.atde.predict --bench`):

  | step | rows per second |
  |---|---|
  | features (`preprocess.py`) + Isolation Forest | about 10,700 |
  | plus SHAP reasons on the anomalous rows | about 160 (SHAP costs about 0.2 s per anomalous row) |

  Scoring keeps up with any live rate we have. SHAP does not at flood rates, so a live scorer should explain only the rows it alerts on, after the cooldown.
- **XGBoost never runs on these streams.** It needs packets and bytes split by direction (`src_packets`, `dst_packets`, `src_bytes`, `dst_bytes`), which AWS VPC and Cisco ASA rows don't have. That matches `metrics.json` ("not evaluated") and the ML team's `replay_score.py`. So `family` is `UNKNOWN` with `family_note` saying why. `score(rows, flows=...)` runs XGBoost when per-direction counts are supplied. There are no expected outputs to test its family results against, and `metrics.json` has no XGBoost numbers.

## The field gap: model 1 cannot score our live events
Model 1 reads **network flow records**: one row per connection, as an AWS VPC flow log line or a Cisco ASA "Deny" syslog line (`stream_name`, `timestamp`, `event_id`, `message_sanitized`). Our live events (`events.raw`, from the simulator or the Juice Shop normaliser) are **HTTP access-log events**: one row per request, in the 16-field schema. They describe a different layer.

### What the Isolation Forest needs, against what `events.raw` carries
| model input (`features.json`) | comes from | in `events.raw`? |
|---|---|---|
| `stream_name` aws_vpc_flow_log or cisco_asa | the log type | **no** (we have `source`: juice-shop, web, auth…) |
| source IP (window key, `dir_*`) | flow `srcaddr` / ASA src | yes: `ip` |
| destination IP (`ndst_*`, `dir_*`) | flow `dstaddr` / ASA dst | **no**: only `host` ("juice-shop"), a name, not an address |
| destination port (`dst_port_wellknown`, `nports_*`, `dst_port_logfreq`) | flow `dstport` / ASA dst port | **no** (always 80 behind nginx, never recorded) |
| protocol (`proto_tcp/udp/icmp`) | flow `protocol` / ASA proto | **no** (always TCP for HTTP, never recorded) |
| `packets` | flow `packets` | **no** |
| `bytes` | flow `bytes`, both directions | partly: `bytes_out` is the response body only |
| `duration` | flow end − start | **no**: `response_ms` is server time, not connection length |
| `bytes_per_packet` | bytes / packets | **no** (no packets) |
| `icmp_type`, `icmp_code` (Cisco) | ASA ICMP fields | **no** |
| Cisco zones (`dir_*` for Cisco) | ASA `src outside:` | **no** |
| `dst_port_logfreq` table | the training data's port counts | needs a destination port: **no** |

### What XGBoost needs
`src_packets`, `dst_packets`, `src_bytes`, `dst_bytes` and the protocol: **none** of these are in `events.raw`.

**Verdict: the gap is big, so B1 stops here,** as the build plan asks. Faking the missing fields would be dishonest. For example, constant port 80, protocol TCP and one destination would make `nports_*` and `ndst_*` always 1, and every score would describe our placeholders, not the traffic. We must not wire model 1 to `events.raw` and call its output AI.

## Ways forward (pick one or both; B2 waits on this)
1. **Capture flows in the lab (the real fix, with the backend team).** Put a flow meter on the lab's Docker network (`lab-net`), for example Zeek (`conn.log`) or softflowd with nfdump. Write each connection as an AWS VPC flow log line (`version account eni srcaddr dstaddr srcport dstport protocol packets bytes start end action status`) on a new topic `flows.raw`, with `stream_name: aws_vpc_flow_log`. Model 1's own parser then works unchanged. Zeek's `conn.log` also has `orig_pkts`, `resp_pkts`, `orig_bytes` and `resp_bytes`, which gives XGBoost its per-direction split, so families could run too. This was build plan C1's flow-record ask.
2. **Replay held-out flow logs as their own stream (build plan B4).** Stream the test split of `pool_split.parquet` (on the ML laptop) onto `flows.raw` at real speed, scored by `ml/atde/predict.py`, with its labels kept apart for evaluation. This shows the model honestly on the data it was trained for. The dashboard labels it as replayed flow logs, not lab capture.
3. **Not recommended:** retraining an HTTP-log model on our own events. That's a new model 1, not this one.

## What the ML team should confirm
- The rolling features need history: a live scorer keeps 3600 s (Cisco) or 600 s (AWS) of rows per stream and scores each new row against it. Is that what they intended for live use?
- The AWS anomaly cutoff gives precision 0.23 at recall 0.61 (Cisco 0.07 at 0.98, `metrics.json`). On a live stream most model alerts will be false positives, so the dashboard should present them as "unusual" signals that add to incidents, not as incidents on their own.
- XGBoost: the source of per-direction counts, and test-split metrics for it.

## The scoring service (B2): built, waiting for flow records
`ml-scorer` (compose service, `ml_scorer/`) reads `events.enriched` and `flows.raw` in 1 s micro-batches. It scores every row model 1 can read: a flow record with `stream_name` and `message_sanitized`, using the bundle's `preprocess.py` and the stream's own history for the rolling windows.
- **A row a rule flagged** gets a model alert attached to the same event (`rule_flagged: true`), so the incident gets a risk score.
- **An unflagged anomalous row** gets a model alert that can open an AI-only incident, at most one per source address per minute, because precision is low.
- **Alerts follow contract 5.1:** `rule_id` null, `model` `atde-1.0.0`, `severity` (never critical; an unclassified anomaly is low), `ip`, `user` and `host` (from the flow line), `class` (`anomaly`, or the XGBoost family), `probability`, `anomaly_score`, `risk_score` and `reasons`.
- **Every score goes to ClickHouse `netra.ml_scores`.** The scorer creates the table.
- **Heartbeat:** a Postgres `ml_models` row every 5 s. The API serves it as `GET /models` and the `models` message: ready under 15 s since the last heartbeat, offline after. The ops health watch checks it (`ml_scorer`, failed after 30 s), and the container healthcheck reads the same heartbeat file.
- **Never fakes:** an HTTP event from `events.enriched` is counted as not scorable and never scored, and the processor's DummyScorer `risk_score` is never read. **So today, with no flow source, the scorer runs, reports ready with "no flow records received yet", and raises no AI alerts.** That stays true until the lab or a replay writes `flows.raw` (the two ways forward above).
- **Rule alerts** from the processor now carry the event's `ip`, `user` and `host` too, and every incident row exposes the 5.1 fields from the stored alert.

**Tested here** (`tests/test_ml_scorer.py`, on model 1's own held-out flow lines and a recorded Juice Shop event):
- HTTP events are not scored.
- Every flow row is scored, and anomalous ones raise alerts in the contract's shape.
- The per-address cooldown holds.
- A rule-flagged row always gets the model's view.
- Rolling features carry across micro-batches: scores match scoring all rows at once.
- `/models` and the incident fields were checked against a real (embedded) Postgres.

**Only a run on the stack can prove:**
- that the image builds with these pinned libraries (Python 3.12) and starts;
- that it consumes from Redpanda, writes ClickHouse `ml_scores` and produces to `alerts`;
- that the API turns those alerts into incidents and the dashboard shows the AI engine;
- the scorer's speed with real history: rolling features are rebuilt over up to 20,000 history rows per batch, so throughput must be measured, and the history cap lowered if it falls behind;
- that the healthcheck and the ops health watch go red when the scorer is stopped.

## The ML team's `src/score.py` (main 3b2e092)
Their `Detector.score_event` in `src/score.py` no longer scores rule-flagged events. A rule hit now returns the rule's result straight away, with no Isolation Forest score (the earlier `model_score` on rule hits was removed). `score_event` also lost its `enriched_event` parameter.

**The live pipeline is unaffected:** `ml-scorer` scores through `ml/atde/predict.py` (the bundle's `preprocess.py` and the saved Isolation Forests) and never imports `src/score.py`. It still gives every rule-flagged flow row the model's view (`rule_flagged: true`; `tests/test_ml_scorer.py`). Only the ML team's own `ml/model1/replay_score.py` imports from `src/`, and only `src/if_stage.py`.

## Replay (B4): the data and the service
`main`'s `data/replay/` export matches what `replay/producer.py` and `ml/atde/eval_replay.py` read. Checked 2026-10-07:
- 57,758 rows in each file, with the same event ids.
- `flows_test.jsonl`: exactly `stream_name`, `timestamp`, `event_id` and `message_sanitized`, in time order, with no labels inside (13,160 AWS VPC rows and 44,598 Cisco ASA rows).
- `labels_test.jsonl`: `event_id`, `label_binary` (3,824 malicious, 53,934 suspicious) and `incident_ids`.

`make replay` streams the flows onto `flows.raw` with `source: "replay"`. ml-scorer forwards that field to its alerts and to `ml_scores`, which got a `source` column so replay rows are not refused. The evaluation numbers are in `docs/ML_EVAL.md`.

---

# Model 2 (CRIE) Remediation Engine

## What CRIE does and doesn't do

### 1. Hybrid Ranking Architecture and Real Weights
- CRIE scores remediation actions through a hybrid ranker combining structured knowledge-base evidence and ML predictions.
- **Real hybrid weights:** `0.75 evidence + 0.25 ML`
  $$\text{score} = 0.75 \times \text{knowledge\_base\_evidence} + 0.25 \times \text{ml\_probability}$$
- Knowledge-base evidence is derived from fused mappings across MITRE ATT&CK mitigations, Elastic Detection Rules, and MITRE D3FEND defensive techniques.
- The ML model is a MultiOutputClassifier baseline using TF-IDF over technique descriptions and OneHotEncoded tactics.

### 2. Baseline Performance on Unseen Techniques
- The ML ranker **does not beat a popularity baseline on unseen techniques**.
- On techniques not seen during training, ML probability outputs correlate with general action frequency rather than technique-specific suitability. Therefore, grounding in explicit knowledge-base evidence is primary (weighted at 0.75).

### 3. What the Fallback Does Now (Insufficient Evidence Rule)
- When CRIE cannot recommend with sufficient evidence, it returns the existing fallback contract (`{"version": "...", "fallback": {"technique": "...", "mitigations": []}, "human_approval_required": true}`) rather than outputting 3 weak, ungrounded fixes.
- **Exact Insufficient Evidence Rule:**
  An incident triggers the fallback outcome if:
  1. The technique is unknown to CRIE (`technique_id not in technique_to_index`), OR
  2. Fewer than 3 actions pass alert context feasibility and severity gating, OR
  3. The highest knowledge-base evidence score among feasible candidates is below $X = 0.10$ (`top evidence score below 0.10`).
- The dashboard already displays MITRE's standard mitigations for a fallback, so the incident keeps standard authoritative mitigations for analyst review without inventing weak recommendations.

### 4. Containment for Critical Incidents (Severity 5)
- For severity 5 (critical) incidents, CRIE guarantees that the top 3 recommendations include at least one containment action (`block`, `isolate`, `lock`, or `disable`), unless none is feasible for that technique and context.
- If a containment action is available among feasible candidates, the highest-scoring containment action is promoted into the top 3.
- If no containment action is feasible for that technique/context, CRIE explicitly states this in a reason (`containment_status: "No containment action feasible for this technique"` with `contribution: 0.0`).

### 5. Explanations and SHAP
- **SHAP is not in the deployed path.**
- Feature contributions returned in reasons are the exact linear components of the hybrid score:
  - `knowledge_base_evidence` contribution: $0.75 \times \text{value}$
  - `ml_probability` contribution: $0.25 \times \text{value}$
- SHAP tree explainers are not evaluated or executed in the live CRIE inference path.

### 6. Human Review and Evaluation Status
- **No human-labelled evaluation yet; the planned next step is two independent reviewers labelling a gold set.**
- CRIE accuracy numbers are not claimed because independent human evaluation has not yet been performed.
- **Human approval required:** CRIE only recommends; it never carries out an action. Every response explicitly carries `human_approval_required: true`.
- **Safety fixes enabled by default:** Severity mapper (normalizing 1..5, string numbers, and severity names), benign suppression (suppressing automated remediation when Model 1 classifies an event as benign), unknown $\rightarrow$ manual review fallback, and human approval required in the response.

