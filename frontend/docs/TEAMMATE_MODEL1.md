# Model 1: the last stages (teammate brief)

You own **model 1's last stages**: give the model real data to score on the live pipeline, measure how well it does, and drop in the ML team's final model when it arrives. The team lead and Claude Code handle CRIE (model 2), the dashboard and Power BI at the same time, in other folders, so please stay inside the folders listed under "Your files".

The repo is github.com/Anchxt11/netra, branch `integration`. You work on your own branch and hand back a pull request.

## Why this is needed (2 minutes)
- Model 1 (`ml/model1/`, loaded by `ml/atde/predict.py`) was trained on **network-flow records**: AWS VPC flow log lines and Cisco ASA lines. Each row has `stream_name`, `timestamp`, `event_id`, `message_sanitized`.
- The live lab (Juice Shop) only produces **website request logs**, which model 1 cannot read. So today the scorer service `ml-scorer` runs but has nothing to score (`docs/ML_INTEGRATION.md`, "The field gap").
- The fix for the demo: **replay the held-out test flows** (rows kept aside during training) onto the Redpanda topic `flows.raw`. `ml-scorer` already reads that topic, scores every row and sends model alerts. The dashboard already shows them.
- The labels must never go into the stream. They are only used afterwards, to measure precision and recall.

## Set up (once)
1. Install **Git**, **Python 3.12**, **Docker Desktop**, and **Antigravity**. Docker is only needed to run the whole stack; if your laptop can't run it, do everything else and ask Anchit to run step 4 of each task.
2. Clone and make your branch:
   ```
   git clone https://github.com/Anchxt11/netra.git
   cd netra
   git checkout integration
   git pull
   git checkout -b feat/model1-replay
   ```
3. Make a Python environment and install what the tests need:
   ```
   python -m venv .venv
   .venv\Scripts\activate          (Windows)   or   source .venv/bin/activate   (Mac)
   pip install -r ml_scorer/requirements.txt pytest
   ```
4. Check that the existing model tests pass before you change anything: `python -m pytest tests/test_atde.py tests/test_ml_scorer.py -q`
5. Get the data from Aliya (ML team): `data/replay/flows_test.jsonl` (the test split's AWS VPC and Cisco ASA rows, fields `stream_name`, `timestamp`, `event_id`, `message_sanitized`, in time order) and `data/replay/labels_test.jsonl` (`event_id`, `label_binary`, `incident_ids`). The lead has already asked her. `data/` is ignored by git on purpose: keep the files there and don't commit them unless Aliya says they are small and contain nothing private.
6. Open the `netra` folder in Antigravity.

## Your files (only these)
| you may change | you must not change |
|---|---|
| `replay/` (new) | `frontend/` |
| `ml/atde/` | `api/`, `contracts/` |
| `ml_scorer/` | `processor/`, `rules/`, `lab/`, `ops/` |
| `tests/test_replay*.py`, `tests/test_atde.py`, `tests/test_ml_scorer.py` | `model_2_temp/` (CRIE) |
| `docs/ML_EVAL.md` (new), `docs/ML_INTEGRATION.md` | anything in `ml/model1/` (the ML team's bundle) |
| `Makefile`: only a new `replay` target | other Makefile targets |
| `docker-compose.yaml`: only a new `flow-replay` service | the other services |

Never force-push, never rewrite history, never commit passwords, keys or `.env` files.

## How to use Antigravity for this
Paste the **context message** into the agent first, once per conversation. Then paste one task at a time, and check its result before moving to the next.

**Context message**
> You are helping on NETRA, a real-time security dashboard (Microsoft Innovate 2026). Read these first: frontend/docs/TEAMMATE_MODEL1.md (my brief: follow its "Your files" table strictly), docs/ML_INTEGRATION.md, ml/model1/model_card.md, ml/model1/features.json, ml/atde/predict.py, ml_scorer/core.py, ml_scorer/main.py, and section 5.1 of contracts/LIVE_API.md. Rules: never invent data or metrics; never re-implement model 1's feature engineering (always use the bundle's own preprocess.py through ml/atde/predict.py); labels never go into the live stream; don't change files outside my table. After each task, run the tests, show me the output, and commit with a message starting "feat:" or "fix:". Don't push.

**Task 1: the replay stream**
> Build a `flow-replay` service. Code in `replay/` (a small Python program and a Dockerfile), a compose service `flow-replay` under a new profile `replay` that depends on redpanda, and a Makefile target `replay` that starts it the same way `make lab` starts the lab. It reads data/replay/flows_test.jsonl (mounted read-only) and produces each row to the Redpanda topic `flows.raw` in time order, at real speed by default, with SPEED (for example 10 = ten times faster) and LOOP (start again at the end) environment variables. Each row it sends keeps `stream_name`, `timestamp`, `event_id`, `message_sanitized` exactly as in the file, and adds `"source": "replay"`. It never reads or sends the labels. Rewrite each row's `timestamp` to the time it is sent, keeping the gaps between rows, so freshness and the dashboard's clock stay honest, and keep the original time in `original_ts`. Then in ml_scorer/core.py, copy the row's `source` onto the model alert it raises (`"source": "replay"`), and on its ml_scores row if that table has room; nothing else in the scorer changes. Add tests/test_replay.py (rows in order, timing with SPEED, labels never sent, the source field) and extend tests/test_ml_scorer.py for the source field. Run `python -m pytest tests -q`.

**Task 2: how good is it, honestly**
> Write ml/atde/eval_replay.py: it runs data/replay/flows_test.jsonl through ml/atde/predict.py in time order (with history, exactly as ml-scorer does), joins the results to data/replay/labels_test.jsonl by event_id, and prints and saves: rows scored, precision, recall, F1, the confusion matrix, per stream (AWS VPC, Cisco ASA) and overall, at the anomaly cutoff in ml/model1/thresholds.json; how many alerts ml-scorer's one-per-address-per-minute cooldown would actually send; and time to detect per labelled incident (first anomalous row minus first row of the incident). Write docs/ML_EVAL.md with these numbers, the exact command, the data file's row count and date, and plain notes on the limits (XGBoost does not run on these streams, so there are no family results). Only numbers from this run go in the doc. Commit eval_replay.py and the doc.

**Task 3: when the ML team pushes the final model** (wait for the lead's message)
> The ML team updated ml/model1/. Pull it (`git fetch origin` then `git merge origin/integration`). Read model_card.md, features.json, thresholds.json and metrics.json again, and list what changed. Run tests/test_atde.py (it checks every row of samples.jsonl reproduces the bundle's own output); if anything fails, stop and tell me which rows, don't change the model. Update ml/atde/predict.py only if the bundle's interface changed. Rerun Task 2's eval and update docs/ML_EVAL.md. Finally, print the exact class names the XGBoost label encoder returns (stage3_label_encoder.pkl) and whether XGBoost now runs on any live stream.

## Check it on the real stack (step 4 of each task, with Docker)
```
make up
make replay
docker compose logs -f flow-replay ml-scorer
```
You should see the replay sending rows and `ml-scorer` scoring them. Leave it 5 minutes. Then send the lead: `docker compose ps`, the last 50 lines of `docker compose logs ml-scorer`, and the output of `make clickhouse-counts`. `make down` stops everything.

## Hand back
1. `git push -u origin feat/model1-replay`
2. Open a pull request into `integration` on GitHub and send the lead the link.
3. Send the lead, in one message: the test output, the numbers from docs/ML_EVAL.md, the class names from Task 3, and anything the agent said it could not do.

The lead pastes your message into Claude Code, which adds the "Replayed flow logs" label on the dashboard and uses your class names.
