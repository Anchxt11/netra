# Demo runbook

Everything runs on **Anchit's laptop**: the backend (Docker) and the dashboard. Present from his laptop, or mirror its screen. Power BI runs on yours.
Repo: github.com/Anchxt11/netra, branch `main` (the same as `integration`).

## 1. Get the latest code (Anchit, once)
```
git fetch origin
git checkout main
git pull
```

## 2. Start the backend (Anchit), about 3 minutes
```
make up
make lab
make replay
```
- `make up`: Redpanda, processor, ClickHouse, Postgres, the API, ml-scorer (model 1), the ops service.
- `make lab`: Juice Shop with nginx, Vector, the normaliser, a benign user, and two attackers:
  - **attacker2** (172.30.0.11) runs **background attacks**, one every 1 to 3 minutes, so the dashboard always looks like a real server under pressure. It leaves out credential stuffing and HTTP floods, the two attacks NETRA groups across addresses. `make auto-off` pauses it; `make auto-on` resumes it. Change the pace with `AUTO_MIN_S=30 AUTO_MAX_S=90 make auto-on`.
  - **attacker** (172.30.0.10) stays **idle** for the demo attack (`make attack SCENARIO=...`). It has its own address, so its attack always opens its own row, next to the background ones.
- `make replay`: the held-out flow logs, which model 1 scores (the AI engine's incidents).

Check: `make status` shows every container as `running` or `healthy`, and `make api-health` answers ok. If a container keeps restarting: `docker compose logs <name> --tail 50`.

## 3. Start the dashboard (Anchit, another terminal)
```
cd frontend
npm ci
npm run build:live
npm run preview:live
```
Open **http://localhost:4174** in Chrome, full screen (F11), zoom 100 %. Sign in as the analyst account from `api/app/settings.py` (`analyst_username` / `analyst_password`).

Check, top bar: LIVE is ticking, Freshness reads under 5 s. Dashboard: the live feed is moving, and System says "All healthy". Click System: the ATDE and CRIE models show `ready`.

## 4. Power BI (you, on your laptop)
- **Same Wi-Fi or hotspot as Anchit:** follow `docs/POWER_BI.md` (Get data > PostgreSQL, DirectQuery, the six `bi_` views, page refresh 30 s), using Anchit's IP. First test it: `Test-NetConnection <his IP> -Port 5432`.
- **No network:** run `./export_csvs.sh` on the backend laptop and use the CSVs it writes to `powerbi_exports/` (Get data > Text/CSV) and the same page layout.
- Open it before the pitch and leave it on its page.

## 5. Before you walk on (10 minutes before)
- Run one attack so the queue isn't empty: `make attack SCENARIO=brute_force`.
- Close everything else on the laptop. Turn off notifications. Plug in the charger.
- Keep a second browser tab open on the **backup**: http://localhost:4173/live?demo=1 (in `frontend`: `npm run build` then `npm run preview`, a separate terminal). It's the scripted demo and needs no backend.

## 6. The demo, about 6 minutes
| # | say / show | do |
|---|---|---|
| 1 | Home page: "Decisions while the data is still warm." Scroll once: the globe becomes the NETRA eye. | Scroll slowly to the dashboard. |
| 2 | "Live security events, ranked by danger **and** by time left to act." Point at the KPI strip and the freshness meter (the SLA: 5 s p95). | Nothing. |
| 3 | "The background attacks are what a real server sees all day. Now a new attacker." Within seconds a new row appears beside them, and the login-failures KPI crosses its line. | Anchit: `make attack SCENARIO=brute_force` |
| 4 | Open the incident: the countdown ring, how it escalated (each rule, with points), severity × attention × urgency. | Click it in "Needs attention". |
| 5 | "Rules and AI side by side": an AI-engine line or an "Unusual activity" incident from model 1, with its reasons. | Click an incident marked AI. |
| 6 | Fix: CRIE's top 3 fixes, each with D3FEND and why. "Nothing runs on its own: a person approves." | Click **Fix**, then **Approve fix** on #1. |
| 7 | Data exfiltration: the queue re-ranks live. If the same attack repeats, its row shows "+N alerts" instead of a duplicate. | `make attack SCENARIO=data_exfiltration` |
| 8 | Enterprise: System tile (freshness, jobs, models), Thresholds page, the load-test numbers in docs/SLA.md. | Click **System**; open **Thresholds**. |
| 9 | Power BI: the same pipeline as an ops report, refreshing on its own. | Switch to Power BI. |

**A judge attacks it themselves** (on Anchit's laptop):
1. Open **http://localhost:8888** (Juice Shop, behind our nginx sensor). Account, then Login.
2. Email `admin@juice-sh.op`, any wrong password. The first failure opens **Admin abuse** (a failed login on an admin account). Five failures within a minute open **Brute force** from the judge's own address, a new row, within seconds.
3. Then log in with the right admin password (Anchit has it): the incident becomes **account taken over**, severity 5, and jumps to Act now.

Only the 7 core attacks fire rules: `brute_force`, `credential_stuffing`, `account_takeover`, `web_scan`, `sqli`, `http_flood`, `data_exfiltration`. The 8 `evasion_*` attacks are built to slip past the rules, and model 1 reads network flows, not web logs, so they show in the live feed only. Say so if asked: it's why NETRA pairs rules with ML.

Other attacks, if you have time: `web_scan`, `sqli`, `account_takeover`. With the background on, run `credential_stuffing` and `http_flood` only after `make auto-off` (they group across addresses by design), and the ML-test ones `evasion_low_slow_brute`, `evasion_slow_exfil`. To run all of them: `make attack-full`.

## 7. If something breaks
| problem | do |
|---|---|
| Dashboard says RECONNECTING | Wait 10 s. If it stays: `docker compose restart api`. |
| An attack only adds to an existing row | Same attack type from the same address within its window (3 to 15 min) is one incident, on purpose. Run a different type, or wait for the old one to expire. |
| An attack shows nothing | `make lab-status`; run it again; or switch to the backup tab. |
| System shows a model `offline` | `docker compose restart ml-scorer` |
| Signed out | Sign in again (sessions last 60 minutes: sign in fresh just before the pitch). |
| Anything else, under time pressure | Switch to the backup tab (`/live?demo=1`) and keep talking. |

## 8. After
`make down` stops everything.
