# NETRA: finale plan (2026-10-08)

One day, about 8 hours, 6 people. Everything goes to `main`; no other branches. This file is the single plan: if it isn't here, it isn't in scope.

## Ground rules for the day
- **Work on `main` only.** Before you start: `git checkout main` and `git pull`. Pull again before every push. Small commits, pushed often. Never force-push.
- **Interfaces are frozen.** The alert fields (contracts/LIVE_API.md 5.1), `POST /crie/recommend` (4.7) and `GET /models` (4.6) don't change shape today. Improve what is behind them; the dashboard keeps working.
- **Code freeze at H6.5.** After that, only fixes for something broken in the rehearsal.
- **Honesty stays the selling point.** Only measured numbers on screen and in the pitch. Nothing labelled AI that isn't a model. Nothing fake presented as real.

## What the judges score (Day 2 rubric) and what that means for us
| marks | criterion | what wins it | our answer |
|---|---|---|---|
| 25 | Technical implementation and architecture | Reasoned trade-offs, deliberate choices; **judges ask a member to open the repo and walk through one non-trivial part** | Every member rehearses one walkthrough (table below). The architecture slide shows the trade-offs: Redpanda, at-least-once with idempotent ClickHouse, rules plus ML, correlation in the browser |
| 20 | Working demonstration | Live **on our own machine**, the full flow unaided, **plus an edge case a judge suggests on the spot**. A video caps at the lowest band | A laptop browser on the Azure deployment, with the full stack on Anchit's laptop as a hot spare. Rehearse the edge cases below |
| 15 | Problem fit | Sharp problem, evidence of real need | Alert fatigue numbers with sources (research R4); "time left" as the core insight |
| 15 | Innovation | Novel compared with **existing tools**, not other teams | Comparison with Splunk, Sentinel and Elastic (R6): ranking by time left; honest, explained AI; a human-approved actuator |
| 15 | Impact, viability, scale | **Named users**, deployment path, cost, **"what breaks at 10x"** | The filled 10x load table from the VM, a cost sheet, named pilot users (R7) |
| 10 | Pitch and Q&A | Structure, timing, **every member contributes** | 5 to 10 min, at least 2 min of live demo, 2 to 4 min of questions. Six speaking parts |

**Code walkthroughs (each member, 2 minutes, rehearsed by H6):**
| member | the part they open and explain |
|---|---|
| Lead | `frontend/src/data/backend/correlate.ts`: alerts into incidents, the deadline, the attention score |
| Anchit | `processor/consumer.py` and the rules engine: windows, batching, at-least-once, why ClickHouse is retry-safe |
| ML 1 | `ml/atde/predict.py` and `ml_scorer/core.py`: how a flow is scored, calibrated and explained |
| ML 2 | `ml/crie/engine.py`: how a fix is ranked (evidence plus ML) and checked for feasibility |
| Research 1 | `ops/jobs.py`: scheduled jobs, failure alerting, the SLA check |
| Research 2 | `docker-compose.yaml` and the Azure deployment: what runs where, what is exposed and why |

**Edge cases a judge may ask for (rehearse each):**
- An attack from a new address.
- An evasion attack: "the rules miss it; here's why we pair them with ML".
- Two attacks at once: the queue re-ranks.
- Change a KPI threshold live, then watch it fire.
- Stop a container (`docker compose stop ml-scorer`): the System tile turns red with a sentence, then recovers.
- Reject a fix, then approve the next one.
- Reload the page mid-attack: the history comes back.

## The six goals, who owns them
| # | goal | owner | done when |
|---|---|---|---|
| 1 | Model 1 risk score fixed; model 2 improved | ML duo | Both pass their tests, the contract is unchanged, `docs/ML_EVAL.md` is rerun with the new numbers |
| 2 | Every known bug fixed | Lead (with Claude) for frontend and API; Anchit for Docker and lab | Each row of "Bugs" below is ticked |
| 3 | Power BI remote and properly connected | Anchit sets up the access, lead builds the report | The lead opens a report from another city that refreshes by itself from the deployed database |
| 4 | A better demo: auto attacks plus "judge, attack us" | Anchit (lab), lead (dashboard) | A judge launches an attack from a browser and sees it ranked, explained and fixed in under 30 s |
| 5 | Proper deployment, not one laptop | Anchit | A public HTTPS link that works from any phone |
| 6 | Final UI and refinement | Lead (with Claude) | A check at 1440x900, 1280x720 and on a projector |
| 7 (only if time) | Approve a fix and it is applied (Juice Shop only) | Lead + Anchit | See section 7 |

## Timeline
| when | lead + Claude | Anchit (+ Claude on his laptop) | ML duo | research duo |
|---|---|---|---|---|
| H0 to H0.5 | Confirm decisions (bottom of this file); repo cleanup | Push last night's demo work to `main`; create the Azure VM | Agree on the risk-score fix (section 1) | Read this file; start R1 and R2 |
| H0.5 to H3 | Bugs (frontend, API); "Launch attack" panel | Stack on the VM, HTTPS, the domain | Model 1 fix; model 2 work | Demo storyboard; Q&A bank |
| H3 to H5 | Point the dashboard at the VM; build the Power BI report | Power BI access; auto-attack schedule; judge entry point | Hand over by H5, with tests | Security review of the deployment; pitch numbers with sources |
| H5 to H6.5 | UI refinement; section 7 if ahead | **Fill the 10x load table** (docs/SLA.md) on the VM; fix what breaks | Rerun ML_EVAL; update the model cards | Cost sheet; named users; each member rehearses their code walkthrough |
| H6.5 to H8 | **Freeze.** Two full rehearsals on the deployed system | Same | Same | Time the pitch; play hostile judge |

## 1. Machine learning (ML duo)
**Model 1's risk score.** Today `risk_score` is the Isolation Forest score clamped to 0..1, which isn't a probability, so the numbers don't mean much. Precision is 0.15 at the current cutoff (docs/ML_EVAL.md). Suggested fix, in order of value:
1. **Calibrate the score.** Turn the raw score into "how unusual compared with normal traffic": the percentile of the score among benign validation rows (an empirical CDF). Then 0.99 means "rarer than 99 % of normal traffic". It's explainable in one sentence, and no retraining is needed.
2. **Pick the alert cutoff by a target false-alarm rate** (for example 1 % of benign traffic) on the validation split, per stream, and write it to `thresholds.json`. Report precision, recall and PR-AUC at that cutoff.
3. Keep `ml-scorer`'s contract: `risk_score` stays in 0..1, and only its meaning improves. Update `model_card.md`.

**The biggest gap: model 1 can't see the lab.** It reads network flows; the lab (and the judges' attacks) produce web requests, so the AI engine never sees a live attack, and the 8 evasion attacks go unnoticed. If there is capacity, this matters more than anything else in ML today. **A small web-behaviour model** on features we already have per source address (requests per minute, distinct paths, 4xx share, failed logins, bytes out, time between requests) over 60 s windows. Labels come free: the attacker containers (172.30.0.10 and 172.30.0.11) are malicious and the benign user (172.30.0.20) is normal. Collect 30 to 60 minutes with `ATTACKER_COMMAND=auto_attack`, train an Isolation Forest or gradient boosting, test on the evasion scenarios, and serve it through the same `ml-scorer` alert format. **Never use the IP address as a feature**: it would learn the label, not the behaviour.

**Model 2 and "deep learning, maybe YOLO".** YOLO detects objects in images. Our inputs are incidents (technique, severity, context) and the output is a ranked list of fixes, so YOLO doesn't fit, and a judge would ask why. If the mentor wants deep learning, these are grounded options you can defend:
- **Text embeddings for matching fixes to incidents.** A small sentence-embedding model (for example MiniLM, CPU-friendly) embeds the incident's sentence and each D3FEND or ATT&CK mitigation description; candidates are ranked by similarity, then filtered by CRIE's existing feasibility rules. It handles techniques CRIE has never seen, and that solves the "unknown" fallback.
- **A learned ranker** (a small neural network or LambdaMART) over CRIE's current features, trained on its knowledge base, if you have labels.
- Either way: keep the hybrid score and its two reasons, same output, same contract. Ship it only if it beats the current version on the samples.

## 2. Bugs (tick when fixed, add new ones here)
| # | bug | owner |
|---|---|---|
| B1 ✓ | `bi_decisions` is always empty: the R3 decision line ends with "(recommended by …)", which the view's pattern (ops/bi.py) rejects | Claude (lead) |
| B2 ✓ | `sla_check` job fails with HTTP 503 right after start-up (the API isn't ready yet): retry, or skip the first minute | Anchit |
| B3 ✓ | `make replay` and every `--build` fail when Docker Hub resolves over IPv6 (goes away on the VM; for laptops, a note in the README) | Anchit |
| B4 ✓ | Same attack type from the same address joins the open incident (by design), so a repeated demo attack seems to do nothing: show "+N new alerts" on the row | Claude (lead) |
| B5 | The dashboard has never been checked against the real CRIE engine (only the stand-in) | Anchit (on the VM) |
| B6 | The attacker's "Artificial Risk Score" must never reach the screen or the pitch | everyone |
| B7 | `bi_kpi_alerts` exported empty: confirm KPI alerts are written to Postgres when a KPI crosses its line | Claude (lead) |
| B8 | The "Add model 1 and model 2 files" push added `netra` as a link to a nested copy of the repo (a gitlink, mode 160000) and a folder named `model 2` with a space; remove the gitlink (`git rm --cached netra`) and rename the folder | ML duo |
| … | add yours | |

## 3. Power BI, remote
The deployed VM fixes "not in the same city": Postgres is on the VM, and Power BI Desktop on the lead's Windows laptop connects to it over the internet (DirectQuery, page refresh 30 s), following docs/POWER_BI.md with the VM's address. Security: open port 5432 **only to the lead's public IP** (an Azure network security group rule), connect as the read-only `netra_bi` user, with a new password set in `.env` on the VM. Publishing to the Power BI service is optional: it needs a work or school Microsoft account and limits refresh to 30 minutes on a free workspace, so present from Desktop.

## 4. The demo
- **"Judge, attack us" from the dashboard.** A small "Launch attack" panel (signed-in admin only) lists the 7 core attacks plus 2 evasion ones. A click asks the API to run that scenario in the attacker container. The judge watches it appear, rank and get a fix. That's safer than giving judges Juice Shop directly, and it works from their own phone.
- **Hands-on option:** Juice Shop's login page behind our nginx on its own URL, so a judge can mistype the admin password five times on their phone. Rate-limited, only the needed paths open, and shut down after the event (security review: research duo).
- **Automatic attacks** on a schedule (`ATTACKER_COMMAND=auto_attack`, slowed to one attack every 1 to 3 minutes) so the dashboard is never empty, paused while a judge attacks.
- The research duo writes the storyboard; Claude turns it into DEMO_RUNBOOK.md.

## 5. Deployment (and the answer to "what breaks at 10x?")
**Recommendation: one Azure VM running the whole Docker stack.** Why:
- **Microsoft Innovate:** judges will ask what runs on Azure.
- **It fixes several problems at once:** the single-laptop risk, remote Power BI (the database gets a public address with a firewall), and the IPv6 build problem.
- **No re-architecture:** the stack is already Docker Compose.

Shape: Ubuntu 22.04 VM, 4 vCPU and 16 GB (for example `Standard_D4s_v5`), Docker plus Compose. Caddy in front for HTTPS on a free name (`<ip>.sslip.io`, or our own domain), serving the dashboard build and passing `/api` and `/ws` to the API, all on one address, so no CORS problems. Only ports 80, 443 and (for the lead's IP only) 5432 are open. Change every default password and `jwt_secret` before it's public. Keep Anchit's laptop running the same stack as a fallback.

**Cost (for the viability question):** a 4 vCPU, 16 GB VM is roughly USD 0.17 to 0.20 an hour, so about USD 4 to 5 a day or USD 130 to 150 a month if left on. Deallocate it when not in use. Check the live price in the Azure pricing calculator for our region before quoting it.

**Scale path, each step justified, not "Microsoft for its own sake":**
- **Redpanda to Azure Event Hubs.** Event Hubs speaks the Kafka protocol, so the processor's Kafka client points at it with a config change, not a rewrite.
- **Postgres to Azure Database for PostgreSQL.** Managed backups, and Power BI connects without a laptop in the middle.
- **ClickHouse stays, or moves to Azure Data Explorer or a Fabric Eventhouse** for time-series analytics.
- **Containers to Azure Container Apps or AKS,** so the processor and `ml-scorer` scale out by Kafka partition.

The 10x table in docs/SLA.md, measured on the VM, says which hop breaks first. That's the honest answer to "what breaks at ten times the usage". **Fallback if Azure access is slow:** run on Anchit's laptop behind a Cloudflare Tunnel (free, about 10 minutes) for the public HTTPS link.

## 6. UI and refinement
The lead's list, plus: projector contrast, 1280x720, the "+N new alerts" row (B4), the Launch-attack panel, a "Replayed flow logs" label (if the replay runs), and removing anything that still says PENDING but is now measured.

## 7. If time permits: approved fixes applied automatically (Juice Shop only)
An analyst approves "Block source IPs", and nginx starts refusing that address within seconds. The live feed shows the attacker's requests turning into 403s, and the incident cools. Grounded and explainable:
- An **actuator** service with an allowlist of 3 actions it can carry out in the lab: block an IP (an nginx deny list plus a reload), rate-limit login (an nginx `limit_req` zone), lock an account (a Juice Shop admin API call or a deny rule on that email). Anything else stays "approved, carried out by a person".
- Each action is **reversible** (an undo button) and **expires** (for example after 15 min), and each is logged with who approved it, when, and the CRIE version.
- The pitch claim, kept honest: "In the lab, approved fixes are applied in seconds through an allowlisted actuator. In a company, the same actuator would call the firewall, the identity provider or the WAF through their APIs, still behind a human approval."

## End of day: repo hand-in
- Delete the merged branches once everyone is on `main`. `feat/person-a-clickhouse` (one unmerged commit) is kept as a tag before its branch goes, so nothing is lost.
- Remove Claude Code's files and mentions (CLAUDE.md files, `.claude/` folders, "Co-Authored-By" commit trailers) as the last step, after the code freeze. Commit trailers live in the history, so removing them means rewriting history and a force-push, and everyone re-clones afterwards. Do it once, last, together.

## Research duo
- **R1, the judging criteria:** map each criterion to what we show, and where. Flag any criterion we don't cover by H2.
- **R2, the demo storyboard (3, 5 and 8 minute versions):** what the judge sees at each moment, which attack, the line we say.
- **R3, the Q&A bank:** 30 likely questions with short true answers (why not Splunk, Sentinel or Elastic; false positives; why rules plus ML; why a human approves; how it scales; privacy; what is real and what is simulated).
- **R4, numbers with sources:** alert fatigue, mean time to respond, analyst workload, from reputable reports (with links). Only quote what we can cite.
- **R5, a security review of our own deployment:** exposed ports, the Juice Shop entry point, default passwords, rate limits. A judge in cybersecurity may try it.
- **R6, competitive framing:** one slide on how SIEMs and SOAR tools rank alerts, and where "time left" and the human-approved actuator differ.
- **R7, named users and adoption:** who buys and uses this. The SOC analyst (NETRA) and the risk or SOC manager (the Power BI report). A short call with the university IT or security team, or a small company's IT lead, for one quote or interest note, is worth more than any slide. Plus the adoption path: one web app first, then more log sources.

## Decisions (2026-10-08)
1. Azure: Anchit sets up the VM on the Azure for Students credit (USD 100).
2. Repo cleanup: done (generator/ kept).
3. Branches: delete the merged ones once everyone confirms they're on `main`.
4. Rubric: received; see the top of this file.
