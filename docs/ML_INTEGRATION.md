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
