# Build plan (updated 2026-10-07)

Checked against GitHub (github.com/Anchxt11/netra) on 2026-10-07. The frontend is done (light refinements at the end only), so this plan covers what is left: bringing the backend team's work in, model 1 on everything, Power BI, and the rehearsal.
Paste the prompts into **Track 1** (the Claude Code session at the repo root) one at a time; each ends with tests and a commit, and asks before pushing.

## Where things are
| part | where | state |
|---|---|---|
| Frontend (dashboard v2, landing, sign-in, live feed, KPI strip, thresholds page, SYSTEM jobs and SLA rows) | `integration` | **done** |
| A1 live KPIs and threshold alerts | `integration` (0a23226) | **done** |
| A2 freshness SLA (`docs/SLA.md`, time to screen) | `integration` (8269de1) | **done** |
| A3 scheduling and failure alerting (`ops` service) | `integration` (5f72070) | **done** |
| A5 Power BI data side (rollup, `bi_` views, read-only user, `docs/POWER_BI.md`) | `integration` (9ed4724) | **done**; the report is built at the venue |
| Juice Shop lab (nginx, Vector, normaliser to `events.raw`, attack bots, benign users; `make lab`) | `feat/event-gen` | built, **not on `integration`** |
| Concurrency | `concurrency` | **a plan only** (`Concurrency/Netra_Concurrency_Fix_Plan.md`); the code changes it lists are not made yet |
| Model 1 (ATDE 1.0.0: Isolation Forest per log type, then XGBoost) | `origin/main` (`ml/model1/`) | first version pushed; the **updated version is still coming** |
| CRIE (model 2) | | not started; fixes fall back to MITRE's mitigations |

## What changed since the first plan
- **Juice Shop replaces the simulator** as the live source (`make lab`). The simulator stays only as an option (`make sim`); never run both.
- **Model 1 scores everything**, flagged and unflagged: it gives a risk score to what the rules flagged too, and raises what the rules missed.
- **A4 (load test) belongs to the backend team**, through their concurrency work; their numbers go into `docs/SLA.md`'s results table.
- **The D (frontend) section is finished** and removed.

## The biggest risk: what model 1 reads
Model 1 was trained on **network-flow records** (packets, bytes, ports, protocol, counts per address over 60 s and 600 s, from AWS VPC flow logs and Cisco ASA). The Juice Shop lab produces **web-request events** from nginx (method, path, status, bytes, user). Those are different fields. Either the lab also produces flow records (for example from Vector or a capture on the lab's Docker network), or the ML team maps web events onto the model's features. **Decide this with the ML team before B2.** B1 lists the exact gap.

## Run order
| # | what | who | needs |
|---|---|---|---|
| M1 | bring the Juice Shop lab into `integration` | Track 1 | now |
| M2 | concurrency changes from the backend's plan | backend team (or Track 1 if they ask) | M1 |
| B0 | send the ML team the missing files message | you | now |
| B1 | load model 1, prove it scores like training, list the field gap | Track 1 | updated model pushed |
| B2 | the scoring service: model 1 on all traffic | Track 1 | B1, field gap settled |
| B3 | model 1 on the screen | Track 1 (touches `frontend/`) | B2 |
| C2 | end-to-end run on the Juice Shop lab | Track 1 + Anchit | M1, B2 |
| P1 | Power BI practice (CSV) | you | Anchit's CSV export |
| P2 | Power BI live report | you + Anchit | at the venue |
| E1 | runbook and rehearsal | everyone | everything |
| F1 | frontend refinements and redeploy | Track 2 | last |

**If time runs out, keep:** M1, B1, B2, C2, P2, E1. **Then:** M2, B3, F1. **Later:** B4, B5, CRIE.

---

## M. Bring the backend team's work in

**M1 The Juice Shop lab** (Track 1)
> Merge `origin/feat/event-gen` into `integration` (don't switch away from `integration`). Keep the backend team's docker-compose.yaml, Makefile, README and lab/ as theirs, and keep our A3 ops service and A5 Postgres changes in docker-compose.yaml (list every conflict you resolve). Then check, by reading the code: the normaliser writes `events.raw` in the 16-field schema that the processor, the rules and the dashboard expect; logins from Juice Shop become `login` events with the email as `user`; and add a way to tell lab traffic from the simulator (for example `source: "juice-shop"` or a lab field) so the dashboard can label it "Lab capture" honestly. Update frontend/docs/BACKEND_INTEGRATION.md "Where things are" and "Run it" for `make up` plus `make lab`. Commit only your own paths; ask me before pushing.

**M2 Concurrency** (backend team; Track 1 only if they ask)
> Implement `Concurrency/Netra_Concurrency_Fix_Plan.md` exactly as its "Implementation Order" says (processor commits after output instead of flushing per event, partitioning by source IP kept, Vector disk buffer, ClickHouse safe on retries), then its Step 5 test, and record the numbers in docs/SLA.md's results table. Nothing outside that plan.

---

## B. Model 1 on all traffic
How it fits now: the rules flag known attacks; **model 1 scores every event**. For flagged events it adds a risk score and its reasons to the incident; for unflagged ones it raises what the rules missed as an AI-only incident.

**B0 Message to the ML team** (send now)
> Thanks for model 1 in `ml/model1/`. For the updated version, please add three files to that folder: `metrics.json` (test-set precision, recall, F1, PR-AUC, confusion matrix), `thresholds.json` (the anomaly cutoff and the confidence below which XGBoost says UNKNOWN), and `samples.jsonl` (about 100 test rows with the exact output your code gives, so we can prove live scoring matches yours). And one decision we need together: the model reads network-flow fields, but the Juice Shop lab produces web-request events from nginx. Can the model score those (with a mapping), or should the lab also produce flow records?

**B1 Load model 1 and prove parity** (Track 1, when the updated model is pushed)
> Model 1 is in ml/model1/ (VERSION, features.json, preprocess.py, the Isolation Forest models per log type, the XGBoost model and label encoder, model_card.md). Read model_card.md and features.json first. Write ml/atde/predict.py: load once; `score(rows)` returns the anomaly score, the family (or UNKNOWN), the probability and the top 3 SHAP reasons, using the bundle's own preprocess.py (never re-implement features). If samples.jsonl exists, test that every row reproduces its expected output; if not, say so. Measure rows per second. Then compare features.json with what our live events actually carry (events.raw from the Juice Shop normaliser) and write the exact field gap into docs/ML_INTEGRATION.md; stop there if the gap is big.

**B2 The scoring service** (Track 1, after the field gap is settled)
> Build an `ml-scorer` compose service: it consumes `events.enriched` (or the flow topic, if the lab produces one), builds features with the bundle's preprocess.py, and scores **every event** in 1 s micro-batches. For events a rule flagged, it emits a model alert attached to the same event (rule_id null, model "atde-<version>", risk score, family, top reasons) so the incident gets a risk score; for unflagged events above the anomaly cutoff, it emits a model alert that opens an AI-only incident. Alerts carry the event's ip, user and host (contracts/LIVE_API.md 5.1). Scores go to a ClickHouse `ml_scores` table. Report version and heartbeat for `models`, add a healthcheck, and make the A3 health watch include it. Never send the placeholder DummyScorer's output as a model alert. Tests with recorded events.

**B3 Model 1 on the screen** (Track 1, in frontend/)
> In frontend/src/data/backend: model alerts on a flagged event add an "AI engine" signal with its score and reasons to that incident ("AI engine: unusual for this address, score 0.81"); model alerts with no rule hit open an AI-only incident named "Unusual activity" (or the model's family when it names a known attack). ATDE shows ready with its version from `models`. DETECTIONS / MIN splits rules and AI. Update tests/correlate.test.ts, `npm test`, `npm run build`.

**B4 Prove the AI catches what rules miss** (later)
> Replay the held-out test split through the live pipeline with its labels; report precision, recall and time to detect for rules alone, model alone and both, in docs/ML_EVAL.md. Only numbers from this run go in the deck.

**B5 Retraining** (later)
> ml/train.py rebuilds the bundle reproducibly and promotes it only if it is no worse; the ops service's 02:00 job runs it.

---

## C. Juice Shop end to end

**C2 One full run** (Track 1 with Anchit, on his laptop)
> With `make up` and `make lab` running, check that each attack the lab runs fires the matching rule, that the incident sentences read well for Juice Shop paths and emails, that the live feed shows normal and attack traffic, and that the dashboard says "Lab capture". Fix what reads badly. Write one command per attack into docs/DEMO_RUNBOOK.md.

---

## P. Power BI
The data side is done (`docs/POWER_BI.md`). Power BI Desktop runs on your Windows laptop and reads Anchit's Postgres over the network, so the live report waits for the venue.

**P1 Practice now:** when Anchit has the stack running, he exports the `bi_` views as CSV (commands in `docs/POWER_BI.md`) and sends them. You build the page from the CSVs (Get data > Text/CSV) to learn the screens; ask Track 2 to walk you through it.

**P2 At the venue (30 to 45 minutes):** both laptops on Anchit's phone hotspot; Anchit runs the stack and sends his IP; you run `Test-NetConnection <his IP> -Port 5432`; then rebuild the page live (Get data > PostgreSQL database, DirectQuery, the `bi_` views, automatic page refresh) and save `bi/NETRA_Ops.pbix`.

---

## E. Rehearsal

**E1 Runbook and dry run** (everyone)
> Write docs/DEMO_RUNBOOK.md: start order and checks (`make up`, `make lab`, the dashboard with `npm run build:live` and `npm run preview:live`, sign in), the scripted attacks, what to show in Power BI, and the fallback if anything fails (the simulated site, `/live?demo=1`). Run the whole demo once and fix what breaks. Update the deck's slides 5, 7, 8 and 9 with real numbers only.

**F1 Frontend refinements and redeploy** (Track 2, last)
> Your list of small refinements; then both builds, a check at 1440×900 and 1280×720, and the Vercel redeploy steps.
