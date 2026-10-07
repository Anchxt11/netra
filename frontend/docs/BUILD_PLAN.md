# Build plan (updated 2026-10-07)

Checked against GitHub (github.com/Anchxt11/netra) on 2026-10-07. The frontend is done (light refinements at the end only), so this plan covers what is left: bringing the backend team's work in, model 1 on everything, Power BI, and the rehearsal.
Paste the prompts into **Track 1** (the Claude Code session at the repo root) one at a time; each ends with tests and a commit, and asks before pushing.

## Who runs what (Claude Code is only on your laptop)
Claude Code cannot reach Anchit's laptop. Everything between the two laptops goes through GitHub and messages:
1. **Your laptop, Claude Code** writes and tests the code (unit tests, the build, the stand-in API with `npm run live-backend`), commits, and pushes to `integration` once you say yes.
2. **You send Anchit** the "Anchit's steps" block for that step (copy it from this file into a message). Each block starts with `git pull` and lists every command he types, and what to send back.
3. **Anchit runs them** on his laptop (Docker, the full stack, Juice Shop) and sends back what the block asks for: the terminal output as text and a screenshot of the dashboard.
4. **You paste his reply into Track 1**, which reads it, fixes what broke, and pushes again. Repeat until his run is clean.

Rule of thumb: anything with `make`, `docker` or a database runs on **Anchit's** laptop; anything with `npm`, Power BI or Claude Code runs on **yours**.

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
| CRIE (model 2, recommends fixes) | ML team (Aliya) | being packaged; ready before the event. Until it is plugged in, fixes fall back to MITRE's mitigations |

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
| M1 | bring the Juice Shop lab into `integration`, push | Track 1, then Anchit runs it | now |
| M2 | concurrency changes from the backend's plan | backend team, on their own laptops | M1 |
| B0 | send the ML team the missing files message | you | now |
| B1 | load model 1, prove it scores like training, list the field gap | Track 1 | updated model pushed |
| B2 | the scoring service: model 1 on all traffic, push | Track 1, then Anchit runs it | B1, field gap settled |
| B3 | model 1 on the screen | **done** (Track 2) | B2 |
| R1 | load CRIE and prove it matches the notebook | Track 1 | CRIE handed over |
| R2 | the fix endpoint `POST /crie/recommend`, push | Track 1, then Anchit runs it | R1 |
| R3 | CRIE's fixes on the screen | Track 1 (touches `frontend/`) | R2 |
| C2 | end-to-end run on the Juice Shop lab | Anchit runs it, you relay to Track 1 | M1, B2 |
| P1 | Power BI practice (CSV) | Anchit exports, you build | Anchit's CSV export |
| P2 | Power BI live report | you + Anchit, same room | at the venue |
| E1 | runbook and rehearsal | everyone | everything |
| F1 | frontend refinements and redeploy | Track 2 | last |

**If time runs out, keep:** M1, B1, B2, C2, P2, E1. **Then:** R1, R2, R3, M2, B3, F1. **Later:** B4, B5.
R and B don't depend on each other: start whichever model arrives first.

---

## M. Bring the backend team's work in

**M1 The Juice Shop lab** (Track 1)
> Merge `origin/feat/event-gen` into `integration` (don't switch away from `integration`). Keep the backend team's docker-compose.yaml, Makefile, README and lab/ as theirs, and keep our A3 ops service and A5 Postgres changes in docker-compose.yaml (list every conflict you resolve). Then check, by reading the code: the normaliser writes `events.raw` in the 16-field schema that the processor, the rules and the dashboard expect; logins from Juice Shop become `login` events with the email as `user`; and add a way to tell lab traffic from the simulator (for example `source: "juice-shop"` or a lab field) so the dashboard can label it "Lab capture" honestly. Update frontend/docs/BACKEND_INTEGRATION.md "Where things are" and "Run it" for `make up` plus `make lab`. You cannot run Docker here (it runs on a teammate's laptop), so prove what you can with tests and by reading the code, and say plainly what only his run can prove. Commit only your own paths; ask me before pushing.

**Anchit's steps after M1** (send this once Track 1 has pushed)
> 1. `git fetch`, then `git checkout integration`, then `git pull`
> 2. `make up`, wait until `docker compose ps` shows everything healthy, then `make lab`
> 3. Leave it for 5 minutes, then send me: the output of `docker compose ps`, the last 50 lines of `docker compose logs processor` and of `docker compose logs lab-normalizer`, and any error you saw.

Paste his reply into Track 1: "Here is a teammate's run of M1 on Docker. Fix what broke and ask me before pushing."

**M2 Concurrency** (backend team; Track 1 only if they ask)
> Implement `Concurrency/Netra_Concurrency_Fix_Plan.md` exactly as its "Implementation Order" says (processor commits after output instead of flushing per event, partitioning by source IP kept, Vector disk buffer, ClickHouse safe on retries), then its Step 5 test, and record the numbers in docs/SLA.md's results table. Nothing outside that plan.

The backend team does this on their own laptops, not through your Claude Code. Your only job: when they say it is pushed, ask Track 1 to pull it and update the table at the top of this file.

---

## B. Model 1 on all traffic
How it fits now: the rules flag known attacks; **model 1 scores every event**. For flagged events it adds a risk score and its reasons to the incident; for unflagged ones it raises what the rules missed as an AI-only incident.

**B0 Message to the ML team** (send now)
> Thanks for model 1 in `ml/model1/`. For the updated version, please add three files to that folder: `metrics.json` (test-set precision, recall, F1, PR-AUC, confusion matrix), `thresholds.json` (the anomaly cutoff and the confidence below which XGBoost says UNKNOWN), and `samples.jsonl` (about 100 test rows with the exact output your code gives, so we can prove live scoring matches yours). And one decision we need together: the model reads network-flow fields, but the Juice Shop lab produces web-request events from nginx. Can the model score those (with a mapping), or should the lab also produce flow records?

**B1 Load model 1 and prove parity** (Track 1, when the updated model is pushed)
> Model 1 is in ml/model1/ (VERSION, features.json, preprocess.py, the Isolation Forest models per log type, the XGBoost model and label encoder, model_card.md). Read model_card.md and features.json first. Write ml/atde/predict.py: load once; `score(rows)` returns the anomaly score, the family (or UNKNOWN), the probability and the top 3 SHAP reasons, using the bundle's own preprocess.py (never re-implement features). If samples.jsonl exists, test that every row reproduces its expected output; if not, say so. Measure rows per second. Then compare features.json with what our live events actually carry (events.raw from the Juice Shop normaliser) and write the exact field gap into docs/ML_INTEGRATION.md; stop there if the gap is big.

**B2 The scoring service** (Track 1, after the field gap is settled)
> Build an `ml-scorer` compose service: it consumes `events.enriched` (or the flow topic, if the lab produces one), builds features with the bundle's preprocess.py, and scores **every event** in 1 s micro-batches. For events a rule flagged, it emits a model alert attached to the same event (rule_id null, model "atde-<version>", risk score, family, top reasons) so the incident gets a risk score; for unflagged events above the anomaly cutoff, it emits a model alert that opens an AI-only incident. Alerts carry the event's ip, user and host (contracts/LIVE_API.md 5.1). Scores go to a ClickHouse `ml_scores` table. Report version and heartbeat for `models`, add a healthcheck, and make the A3 health watch include it. Never send the placeholder DummyScorer's output as a model alert. Tests with recorded events (you cannot run Docker here; say what only a run on the stack can prove). Ask me before pushing.

**Anchit's steps after B2**
> 1. `git pull` on `integration`, then `make up` (it builds the new `ml-scorer`), then `make lab`
> 2. After 5 minutes send me: `docker compose ps`, the last 50 lines of `docker compose logs ml-scorer`, and a screenshot of the dashboard with an incident open.

**B3 Model 1 on the screen** (Track 1, in frontend/)
> In frontend/src/data/backend: model alerts on a flagged event add an "AI engine" signal with its score and reasons to that incident ("AI engine: unusual for this address, score 0.81"); model alerts with no rule hit open an AI-only incident named "Unusual activity" (or the model's family when it names a known attack). ATDE shows ready with its version from `models`. DETECTIONS / MIN splits rules and AI. Update tests/correlate.test.ts, `npm test`, `npm run build`.

**B4 Prove the AI catches what rules miss** (later)
> Replay the held-out test split through the live pipeline with its labels; report precision, recall and time to detect for rules alone, model alone and both, in docs/ML_EVAL.md. Only numbers from this run go in the deck.

**B5 Retraining** (later)
> ml/train.py rebuilds the bundle reproducibly and promotes it only if it is no worse; the ops service's 02:00 job runs it.

---

## R. CRIE (model 2): recommended fixes
How it fits: CRIE is called **per incident, by the API**, not by model 1. Many incidents come only from the rules (model 1 can't read Juice Shop's web events), so CRIE must work with or without model 1's output. The dashboard asks for fixes when an incident opens or changes, and shows the top 3; if CRIE can't recommend, it shows MITRE's mitigations. A person always approves.

**R0 What was agreed with the ML team** (sent 2026-10-07)
- One function to import: `crie_engine.recommend(incident) -> dict`, loads its files once.
- Input: `incident_id`, `attack_type` (our rule types), `mitre_technique`, `severity` (1 to 5), `detected_by`, `rules`, `model` (model 1's `attack_family`, `confidence`, `is_unknown`, `if_score`, `top3`, or `null`), `context` (lists of `src_ips`, `usernames`, `hosts`; `dst_ip` and `domain` usually `null`).
- Output: `version`, and either the top 3 fixes (`action_id`, `name`, `d3fend` id and name, `confidence`, `rank`, `reasons` with feature, value and contribution, `provenance`) or `fallback` (MITRE `technique` and `mitigations`).
- Handover: `VERSION`, `model_card.md`, `metrics.json`, `samples.jsonl` (20 to 50 incidents with the notebook's exact output), and the exact package versions the files were saved with.
- Still to come from her: which CRIE family each of our 8 attack types maps to, and the names of model 1's classes 0 to 7.

**R1 Load CRIE and prove it matches the notebook** (Track 1, when the files are handed over)
> The ML team handed over CRIE (model 2) in ml/crie/ (crie_engine.py, its saved files, VERSION, model_card.md, metrics.json, samples.jsonl). Read model_card.md and frontend/docs/BUILD_PLAN.md section R0 first. Check that the package versions it needs work on Python 3.12 (the API's Docker image is python:3.12-slim); add them, pinned, to api/requirements.txt. Write a test that runs every row of samples.jsonl through `recommend()` and gets exactly the expected output, including an incident with `model: null` and one that returns the MITRE fallback. If any row differs, stop and tell me which; don't change the engine. Measure how long one call takes. Commit only your own paths.

**R2 The fix endpoint** (Track 1)
> Add `POST /crie/recommend` to the API (api/app/routes/crie.py), signed-in users only. It takes one incident in the R0 input shape and returns CRIE's answer unchanged, plus `version`. Load the engine once at start-up; if it fails to load, the API still starts, the endpoint answers 503, and `GET /models` lists CRIE as `failed` with the reason (the models section of contracts/LIVE_API.md; `ready` with its version, trained date and metrics from the bundle when it loads). Cache answers per incident and input for 60 s. Add the endpoint to contracts/LIVE_API.md. Tests for: a rule-only incident, an incident with model 1 output, the fallback, and the engine missing. You cannot run Docker here; say what only a run on the stack can prove. Ask me before pushing.

**Anchit's steps after R2**
> 1. `git pull` on `integration`, then `make up` (it rebuilds the API), then `make lab`
> 2. After 5 minutes send me: `docker compose ps`, the last 50 lines of `docker compose logs api`, and the output of `curl -s http://localhost:8000/models` (if it asks for sign-in, say so).

**R3 CRIE's fixes on the screen** (Track 1, in frontend/)
> In frontend/src/data/backend: when an incident is created, or its signals, severity or model output change, call `POST /crie/recommend` with the R0 input built from the incident (debounced 2 s, one call in flight per incident). Map the answer to the dashboard's `Fix` type (frontend/src/data/types.ts): `d3fend`, `confidence`, `rank`, and each reason as a plain sentence. A `fallback` answer fills `incident.fallback` as today. If the call fails, keep MITRE's mitigations and show nothing invented. CRIE shows ready with its version from `models` (add `offline` to `ModelStatus`). Approving a CRIE fix writes the action id and CRIE's version into the decision log. Update the tests, `npm test`, `npm run build`. Ask me before pushing.

---

## C. Juice Shop end to end

**C2 One full run** (Anchit runs it; you carry the results to Track 1)

**Anchit's steps**
> 1. `git pull` on `integration`, then `make up`, then `make lab`.
> 2. In `frontend/`: `npm install` (first time only), `npm run build:live`, `npm run preview:live`, open http://localhost:4174 and sign in with the development account in `api/app/settings.py`.
> 3. Run each attack the lab has (the commands are in the lab README), one at a time, a minute apart.
> 4. Send me: a screenshot of the dashboard after each attack, and the output of `docker compose logs --since 15m processor`.

**Then paste his reply into Track 1 with this prompt:**
> Here is a teammate's full run on the Juice Shop lab (screenshots and logs below). Check that each attack fired the matching rule, that the incident sentences read well for Juice Shop paths and emails, that the live feed shows normal and attack traffic, and that the dashboard says "Lab capture". Fix what reads badly, and write the start steps and one command per attack into docs/DEMO_RUNBOOK.md. Ask me before pushing.

Repeat C2 after each fix until his run is clean.

---

## P. Power BI
The data side is done (`docs/POWER_BI.md`). Power BI Desktop runs on your Windows laptop and reads Anchit's Postgres over the network, so the live report waits for the venue.

**P1 Practice now:**
- **Anchit's steps:** with the stack and the lab running for at least 15 minutes, run the CSV export commands in `docs/POWER_BI.md` and send you the CSV files.
- **You:** save them in a folder on your laptop, open Power BI Desktop, Get data > Text/CSV, and build the page. Ask Track 2 to walk you through it screen by screen.

**P2 At the venue (30 to 45 minutes):** both laptops on Anchit's phone hotspot; Anchit runs the stack and sends his IP; you run `Test-NetConnection <his IP> -Port 5432`; then rebuild the page live (Get data > PostgreSQL database, DirectQuery, the `bi_` views, automatic page refresh) and save `bi/NETRA_Ops.pbix`.

---

## E. Rehearsal

**E1 Runbook and dry run** (everyone)
Track 1 writes the runbook on your laptop; the dry run happens on Anchit's laptop (or at the venue, together).
> Write docs/DEMO_RUNBOOK.md for a teammate who has no Claude Code: start order and checks (`make up`, `make lab`, the dashboard with `npm run build:live` and `npm run preview:live`, sign in), the scripted attacks, the fix to approve for each (CRIE's top fix), what to show in Power BI, and the fallback if anything fails (the simulated site, `/live?demo=1`, which runs on any laptop with no backend). Every command copy-pasteable, with what the screen should show after it. Ask me before pushing.

Then Anchit follows the runbook start to finish and sends you screenshots of anything that differs; paste them into Track 1 to fix. Update the deck's slides 5, 7, 8 and 9 with real numbers only.

**F1 Frontend refinements and redeploy** (Track 2, last)
> Your list of small refinements; then both builds, a check at 1440×900 and 1280×720, and the Vercel redeploy steps.
