# Build plan: tonight to tomorrow morning

Written 2026-10-06. Four goals: (1) meet every line of Problem 34, enterprise points included; (2) a pipeline for the ML models, starting with model 1 (ATDE); (3) the backend team's Juice Shop capture as a live source; (4) a calmer, more professional frontend.
Paste the prompts one at a time. Each ends with tests, a build and a commit; check what it tells you before the next.

## The idea: two tracks, one contract
The 2-day sprint worked because we agreed the data shapes first. Same again:
- **Track 1: backend, ML, enterprise.** A Claude Code session opened at the repo root (`netra/`).
- **Track 2: frontend.** This session (`netra/frontend/`).
- They meet only at `contracts/LIVE_API.md` (prompt 0.3), so both can run at the same time.

## Run order
| # | prompt | track | time | needs |
|---|---|---|---|---|
| 0.1 | your tasks (below) | you | 20 min | |
| 0.2 | one branch with everything | 1 | 30 min | |
| 0.3 | the contract for everything new | 1 | 30 min | 0.2 |
| B0 | the ML export contract (send to the ML team) | 1 | 15 min | now, before model 1 lands |
| A1 | live KPIs and threshold alerts | 1 | 1.5 h | 0.3 |
| D0 | design direction, with you | 2 | 45 min | can start now |
| B1–B3 | model 1 into the pipeline and onto the screen | 1 | 3.5 h | model 1 files |
| D1–D3 | new look, compact dashboard, live traffic monitor | 2 | 4.5 h | D0, 0.3 |
| A2–A3 | freshness SLA, scheduling, failure alerting | 1 | 2.5 h | A1 |
| C1–C2 | Juice Shop capture as a live source | 1 | 1.5 h | backend team's push |
| A4 | load test (concurrency) | 1 | 1.5 h | A1–A3 on Docker |
| A5 | Power BI report | 1 + you | 1 h + 45 min | A1 |
| D4–D5 | dashboard details, landing redesign | 2 | 3 h | D2 |
| B4 | prove the AI catches what rules miss | 1 | 1 h | B2 |
| D6–D7 | engine pages, final QA, redeploy | 2 | 1.5 h | B1 |
| E1 | rehearsal and runbook | both | 1 h | everything |

**If time runs out, keep:** 0.x, A1–A5, B0–B3, D0–D3, D7, E1. **Then:** B4, D4, D5, C. **Then:** B5, D6.

---

## 0. Set up (now)

**0.1 Your tasks** (I cannot do these for you)
- Decide **which laptop runs the demo stack** and install Docker Desktop there (docker.com). Yours has no Docker today.
- Install **Power BI Desktop** (free, Microsoft Store) on a Windows laptop.
- Message **Anchit**: (a) rename `contracts/topics.yaml ` (it ends with a space, so Windows cannot check it out, which blocks merging on our laptops); (b) push the Juice Shop work to a branch, even unfinished; (c) the backend asks in `docs/BACKEND_INTEGRATION.md`, mainly "put the event's ip, user and host in each alert".
- Send the **ML team** the B0 message below.
- Answer the **decisions** at the end of this file (fonts, landing, AI-only detections).

**0.2 One branch with everything** (track 1, repo root)
> At the repo root, create a branch `integration` from my local `main`. Merge `origin/main` and `origin/feat/person-a-infrastructure` into it. Keep the backend team's docker-compose.yaml, Makefile, README and requirements as theirs, and `frontend/` as mine; list every conflict you resolve. If a file cannot be checked out on Windows, stop and tell me. Run `npm test` and `npm run build` in frontend/, and the backend tests if Python can run them. Don't push yet: show me the result, then ask me before pushing and opening a pull request to `main`.

**0.3 The contract for everything new** (track 1)
> Read frontend/docs/BACKEND_INTEGRATION.md, frontend/docs/BUILD_PLAN.md, api/app (routes, ws.py, consumers.py) and frontend/src/data/source.ts. Write `contracts/LIVE_API.md`: every REST route and WebSocket message the API has today, plus the new ones this plan adds, with example payloads: `kpi` (every 5 s), `kpi_alert`, `traffic` (per second: counts by event type, normal vs flagged by a rule vs flagged by the AI, and a sample of recent events), `ops_alert`, `job_runs`, `models` (name, version, status, trained_at, metrics summary), and the alert fields ATDE adds (ip, user, host, class, probability, top reasons). Mark each as exists or new. Both tracks code against this file. No code.

---

## A. The brief, line by line, made foolproof
| Problem 34 asks for | today | after this section | evidence |
|---|---|---|---|
| A dashboard that updates as new data arrives | streaming: Kafka to WebSocket to screen | the same, plus time-to-screen measured | docs/SLA.md |
| Live KPIs | events/s, freshness, detections/min | KPI strip: events/s, login failure rate, 5xx rate, bytes out, open incidents by tier, freshness | A1 |
| Alerts when a value crosses a threshold | 10 rules (thresholds on events) | plus KPI thresholds, set by an admin, with alerts | A1 |
| A simulated feed you generate | simulator, 7 attacks | plus the Juice Shop lab capture (C) | |
| Power BI or Fabric Real-Time Intelligence | none | Power BI report on the same data, auto page refresh; Fabric path documented | A5, docs/POWER_BI.md |
| Streaming refresh with a documented freshness SLA | p95 shown against 5 s; SLA undocumented | SLA written, measured per hop and in the browser | A2, docs/SLA.md |
| Automated scheduling with failure alerting | stall states on screen only | scheduled jobs, job log, alerts on screen and to a webhook, auto restarts | A3 |
| Performance validated under concurrent load | not done | load test at 1×, 5×, 10× with 1, 25, 100 dashboards; results published | A4, docs/LOAD_TEST.md |

**A1 Live KPIs and threshold alerts** (track 1, then track 2 for the screen)
> Backend: in api/, add a KPI loop that every 5 s computes from ClickHouse (last 1 and 5 minutes): events per second, login failure rate, HTTP 5xx rate, bytes out per minute, and the rule-hit rate. Thresholds live in the existing `config` table (`kpi.<name>.warn`, `kpi.<name>.crit`), editable by admins through the existing PUT /config. A KPI alert fires after 2 breaches in a row and clears after 2 normal readings; store it in a new `kpi_alerts` table and broadcast `kpi` and `kpi_alert` exactly as contracts/LIVE_API.md says. Unit tests for the crossing logic. Then in frontend/: receive `kpi` and `kpi_alert` in the backend source, make the mock engine send the same messages, and show a KPI strip above the dashboard (value, small trend, state in words and colour) plus an admin-only Thresholds page. `npm test`, `npm run build`, commit.

**A2 Freshness SLA, measured and documented** (track 1 then 2)
> Write docs/SLA.md: the definition (event created to visible on the analyst's screen), the target (p95 at most 5 s at up to 10× normal load), a budget per hop (simulator or capture, Kafka, processor, ClickHouse, API push, browser), how each hop is measured (event_ts, processed_ts, stored_ts, the WebSocket server_ts, the browser's receive time corrected by the clock offset), what happens on a breach, and an empty results table for A4. In frontend/, measure time-to-screen p95 per minute in the backend source and show it in SYSTEM next to pipeline freshness. A breach raises a `kpi_alert` of kind `sla`. Build, test, commit.

**A3 Scheduling and failure alerting** (track 1)
> Add a small `ops` service (Python, in docker-compose, no new framework unless you tell me why) that runs jobs on a schedule: health watch every 10 s (API, Postgres, ClickHouse, Kafka consumer lag, processor alive), SLA check every 30 s, daily report at 06:00 (yesterday's SLA and incident summary into `daily_reports`), model retrain at 02:00 (runs ml/train.py when it exists, otherwise records "skipped"), and data retention at 03:00. Every run goes into a `job_runs` table (job, started, finished, status ok, failed or skipped, detail). A failure or an SLA breach writes `ops_alerts`, broadcasts `ops_alert`, and POSTs to ALERT_WEBHOOK_URL if it is set (Teams, Discord or Slack incoming webhook). Give every compose service a healthcheck and `restart: unless-stopped`. Tests: a failing job is recorded and the webhook is called. Then in frontend/: SYSTEM shows the jobs (last run, failed in pink) and the ops alerts. Commit.

**A4 Load test** (track 1, on the Docker laptop)
> Create loadtest/ that runs in a container (compose profile `load`, so nothing is installed on the laptop). Steps of 3 minutes: generator at 1×, 5× and 10× (10, 50, 100 events/s), each with 1, 25 and 100 WebSocket clients that record receive lag (against server_ts and event_ts), plus GET /incidents and /freshness at 20 requests per second. Record /freshness p50 and p95, WebSocket lag p95, API p95, dropped events, Kafka consumer lag and CPU and memory per container. Write docs/LOAD_TEST.md (method, a table per step, pass or fail against docs/SLA.md) and fill SLA.md's results. Record failures as failures; never round a number in our favour.

**A5 Power BI** (track 1, then you build the report)
> Create read-only BI views: in Postgres `bi_incidents`, `bi_decisions`, `bi_job_runs`, `bi_kpi_alerts`; in ClickHouse `bi_traffic_minute` (events per minute by type, normal vs flagged) and `bi_freshness_minute` (p50, p95). Add a read-only BI user to each. Write docs/POWER_BI.md: connect Power BI Desktop to Postgres and to ClickHouse in DirectQuery (check the current connector steps in Microsoft's and ClickHouse's docs first; do not guess), the page to build (KPI cards, traffic line with flagged share, freshness line with the 5 s target, incidents by tier, decisions, job runs), automatic page refresh, and where to save the file (bi/NETRA_Ops.pbix). Add "The Fabric Real-Time Intelligence path": Eventstream from Kafka into an Eventhouse and a Real-Time Dashboard, as the cloud version.

---

## B. The ML pipeline (model 1 = ATDE)
How it fits: the rules flag known attacks. Model 1 looks at the traffic the rules did **not** flag and raises what is unusual. Its alerts join the same incidents (or open AI-only ones), shown as the AI engine with their reasons.

**B0 Message to the ML team** (send now)
> To plug model 1 into the live pipeline we need one folder per version: `ml/models/atde/<version>/` with: the model files (Isolation Forest and XGBoost, joblib or XGBoost JSON); `features.json` (ordered feature names, which raw field each comes from, windows like "per source address over 60 s", types, fill values); `preprocess.py` with `build_features(rows) -> DataFrame`, the exact code used in training; `thresholds.json` (anomaly cutoff, class thresholds); `metrics.json` from the time-split test set (precision, recall, F1, PR-AUC, confusion matrix, per class); `model_card.md`; `samples.jsonl` (100 test rows with the expected output, so we can prove live scoring matches training); `VERSION`. And please answer: what one row is (a flow record? which fields?), the classes (benign, suspicious, malicious?), and the time to score 1,000 rows.

**B1 Load the bundle and prove parity** (track 1, when the files land)
> Read ml/models/atde/<version>/. Write ml/atde/predict.py: load once, `score(rows)` returns anomaly score, class, probability and the top 3 SHAP reasons, using the bundle's own preprocess.py (never re-implement features). Test: every row of samples.jsonl reproduces its expected output. Benchmark rows per second here. If features need fields our live data does not have, stop and list them.

**B2 The scoring service** (track 1)
> Build an `ml-scorer` compose service: it consumes the live topic (the Juice Shop `flows.raw` when it exists, else `events.enriched`), builds features over the same windows with the bundle's preprocess.py, scores in 1 s micro-batches the traffic the rules did not flag (plus a 5% sample of flagged traffic for monitoring), and emits alerts to `alerts` with rule_id null, model "atde-<version>", severity from class and probability, the event ids, ip, user, host and top reasons. Scores go to a ClickHouse `ml_scores` table. It reports its version and heartbeat for `models` and has a healthcheck. Tests with recorded input. Never send the placeholder DummyScorer's output as a model alert.

**B3 Model 1 on the screen** (track 2)
> In frontend/: show model alerts with their reasons ("AI engine: 3.4× this address's normal bytes out, score 0.81"); AI-only alerts open an incident as decided in D-decisions; ATDE shows READY with its version from `models` (not guessed from alerts); DETECTIONS / MIN splits rules and AI for real. Update tests/correlate.test.ts. Build, commit.

**B4 Prove the AI catches what rules miss** (track 1)
> Write a replay tool that streams the held-out test split into the live topic at real speed or 10×, with its labels. An evaluator joins alerts with labels and reports precision, recall and time to detect for rules alone, model alone, and both. Write docs/ML_EVAL.md and a ClickHouse table for Power BI. Only numbers from this run go in the deck.

**B5 Retraining and versions** (track 1, could)
> ml/train.py rebuilds the bundle from the parquet splits reproducibly, evaluates on the test split, and promotes it to `current` only if PR-AUC is no worse than the current model's minus 0.01. The ops scheduler's 02:00 job runs it; a failure raises an ops alert. ml-scorer reloads `current` without a restart.

Later, CRIE (model 2) uses the same bundle contract; the decisions table becomes its training data.

---

## C. Juice Shop as a live source (the backend team leads)
**C1 Message to the backend team** (send when you send 0.1)
> For the dashboard and rules to work unchanged, captured traffic should land on `events.raw` in the existing 16-field schema, with `source: "juice-shop"`. Easiest: a reverse proxy in front of Juice Shop writing JSON access logs, and a shipper that maps them: POST /rest/user/login 401 or 200 becomes event_type login with status failure or success and the email as user; downloads over 50 MB become data_transfer; the rest http_request. For model 1, packet capture on the lab's Docker network only should produce flow records on `flows.raw` with the fields model 1 was trained on (ask the ML team). Run normal-user bots and attack tools only against the lab container, never a shared or venue network.

**C2 Wire it in** (track 1 then 2)
> Run the stack with the Juice Shop source. Check each rule fires on the matching attack, the incident sentences read well for Juice Shop paths and emails, and the traffic monitor shows normal and attack traffic. In frontend/, label the source honestly: "LAB CAPTURE" for Juice Shop, "SIMULATED FEED" for the simulator. Add one command per scripted attack to docs/DEMO_RUNBOOK.md.

---

## D. The frontend: calmer and more professional
What you asked for: keep the vibe (dark, rust, the eye) but drop the "pilot simulation" feel; clean SaaS references (Spline, Squareblack); a compact dashboard with the rest a hover away; fixes behind a FIX button; a clearly visible live monitor of all traffic.

**D0 Design direction** (track 2, with you, 45 min)
> Look at spline.design and [the Squareblack URL you send me] in the browser and note what makes them calm (type, spacing, borders, motion). On a dev-only /kit/direction page, build the dashboard in the new direction with the real components: (1) a KPI strip; (2) the queue and the incident focus always visible; (3) a live traffic monitor always visible; (4) evidence, who is involved, threat scope and system as compact tiles that expand on hover, keyboard focus or click; (5) fixes behind one FIX button that opens the three fix cards. No pixel field, scanlines or corner ticks on the dashboard; quieter borders; one accent. Show me two variations before changing anything real, then update docs/DESIGN.md and docs/PAGES.md to the chosen one (the docs come first).

**D1 New look** (track 2)
> Apply the chosen direction: tokens (I approved editing tokens.css), the typefaces I chose (install only the font package I approved), radii, borders, shadows, motion. Remove the pixel field, scanlines and corner ticks from the dashboard and engine pages. Build, check 1440×900 and 1280×720, commit.

**D2 Compact dashboard** (track 2)
> Rebuild /live to docs/PAGES.md: KPI strip (A1), queue, incident focus, live traffic monitor visible; the rest as expandable tiles (one accessible Expand component: hover, focus and click, Esc to close, respects reduced motion); FIX opens the fix cards with APPROVE FIX and REJECT. Update the tour to the new layout. Build, check both sizes, commit.

**D3 Live traffic monitor** (track 2)
> Show the feed itself, normal traffic included: a per-second stacked chart of the last 5 minutes (normal, flagged by a rule, flagged by the AI) and a live list of recent events (time, address, account, what happened, a tag when flagged), which pauses on hover. Data: the `traffic` message (backend source from the events stream; the mock engine sends the same). It must read clearly from across a room. Build, commit.

**D4 Dashboard details** (track 2)
> Go box by box: queue rows, focus card, escalation, graph, toasts, empty and loading states. Fewer words in capitals, consistent spacing, no element shouting. Show me before and after screenshots at 1440×900.

**D5 Landing page** (track 2)
> Rebuild the home page in the chosen landing direction (decision 2): hero (NETRA, one line, one button, the globe quieter), a real dashboard screenshot, how it works in five calm rows using the existing drawings as still illustrations, an enterprise section (SLA, load test, Power BI, roles: numbers only from docs/LOAD_TEST.md and docs/SLA.md), the live dashboard at the end. Build, check, commit.

**D6 Engine pages** (track 2, could)
> Prompts J and K, from the real model 1 bundle (metrics.json, model_card.md) with `"source": "model-export"`.

**D7 Final QA and redeploy** (track 2)
> Check 1440×900 and 1280×720, keyboard only, contrast, reduced motion, both builds (`npm run build`, `npm run build:live`), no console errors. Then give me the steps to redeploy Vercel.

---

## E. Rehearsal
**E1 Runbook and dry run** (both)
> Write docs/DEMO_RUNBOOK.md: start order and checks, the scripted attacks, what to show in Power BI, and the fallback (the simulated site, `/live?demo=1`) if anything fails. Then we run the whole demo once and fix what breaks. Update the deck's slides 5, 7, 8 and 9 with the real numbers.

---

## Decisions I need from you
1. **Typeface for the new look.** Michroma and Chakra Petch are a big part of the "video game" feel. My recommendation: Michroma only for the NETRA wordmark; **Inter** for the interface (the usual choice for clean SaaS); IBM Plex Mono stays for data. Needs one new package, `@fontsource/inter`. Alternative: IBM Plex Sans (same family as our mono, more corporate).
2. **The landing scroll story.** My recommendation: retire the pinned five-step scroll and keep its drawings as still illustrations in calm sections that fade in as you reach them; the pixel break-apart survives once, in the hero. Alternative: keep the scroll but slower and smaller.
3. **Detections only the AI finds.** My recommendation: a sixth incident type, "Unusual activity", with its own quiet sector on the threat scope, until the model's class names a known attack.
4. **Tokens.** May I edit tokens.css for D1? (CLAUDE.md asks me to check first.)
5. **The demo laptop**, and whether the live demo uses the Juice Shop source, the simulator, or both.
