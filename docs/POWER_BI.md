# NETRA in Power BI

Written 2026-10-07 (build plan A5) for someone opening Power BI for the first time. Menu names were checked that day against Microsoft's own pages, listed under "Sources" at the end. If a button looks different on your screen, follow the source page: Power BI Desktop updates every month.

## What you get
One report page, **NETRA Ops**, that refreshes itself every 30 seconds while it is open:
- 5 KPI cards: events per second, flagged share (%), freshness p95, open incidents, firing KPI alerts
- traffic per minute, with the flagged share
- freshness p95 per minute, against the 5 s target
- incidents by severity
- analyst decisions
- the ops service's job runs

Power BI reads **one source: Postgres**, with the PostgreSQL connector that ships with Power BI Desktop. Nothing else to install, no ClickHouse driver. Traffic and freshness live in ClickHouse, so the ops service copies a per-minute summary into Postgres once a minute (job `bi_rollup`, `ops/bi.py`).

| view (schema `bi`) | one row per | what it holds |
|---|---|---|
| `bi_traffic_minute` | minute (last 6 hours) | events, normal, flagged_rule, flagged_ai, flagged_share, freshness_p50_s, freshness_p95_s |
| `bi_freshness` | minute (last 6 hours) | freshness_p50_s, freshness_p95_s, target_p95_s (5), breach |
| `bi_incidents` | alert | rule_id or model, detected_by (rule or ai), severity, severity_rank, status, created_ts |
| `bi_decisions` | approve or reject | incident_id, decided_at, decided_by, decision, action_id |
| `bi_kpi_alerts` | KPI alert | kpi, level, state, value, threshold, started_at, cleared_at, duration_s |
| `bi_job_runs` | job run | job, started_at, finished_at, duration_ms, status, detail |

Power BI signs in as **`netra_bi`**, a user that can only read these six views. It cannot see the tables behind them and cannot change anything.

---

## 0. Before you start (on the laptop that runs Docker)
1. Start the stack: `make sim`. Wait 2 minutes: the first summary row appears one minute after the ops service starts.
2. Check that the views have rows (this signs in as the read-only user):
   ```
   docker compose exec -e PGPASSWORD=netra_bi_read postgres psql -h localhost -U netra_bi -d soc -c "select count(*) from bi.bi_traffic_minute"
   ```
   A number above 0 means you are ready. `permission denied` or `password authentication failed` means the ops service has not set up the views yet: look at `docker compose logs ops`.
3. The details you will type into Power BI:

   | field | value |
   |---|---|
   | Server | `localhost:5432` (from another laptop: `<this laptop's IP>:5432`, see section 6) |
   | Database | `soc` |
   | User name | `netra_bi` |
   | Password | `netra_bi_read`, or what you set as `BI_PASSWORD` in `.env` |

## 1. Check Power BI Desktop
1. Install it from the Microsoft Store (search "Power BI Desktop", select **Install**). The Store version updates itself and needs no admin rights.
2. Open it. On the **Help** ribbon select **About** and read the **Version** line. Any version from the last few months is fine. The PostgreSQL connector has been included since December 2019, so there is nothing else to install.
3. Power BI Desktop needs Windows 10 or later, 64-bit, and a screen of at least 1440x900. If dialogs are cut off, set Windows display scaling to 100% (**Settings** > **System** > **Display**).

## 2. Connect to Postgres
1. On the **Home** ribbon, select **Get data**. In the **Get Data** window, type `PostgreSQL` in the search box, select **PostgreSQL database**, then **Connect**.
2. In the **PostgreSQL database** dialog:
   - **Server**: `localhost:5432`
   - **Database**: `soc`
   - **Data Connectivity mode**: select **DirectQuery**. This is the important one: DirectQuery asks Postgres every time the page refreshes, while Import copies the data once and goes stale. Automatic page refresh only works with DirectQuery.
   - Select **OK**.
3. The first time, Power BI asks how to sign in. Select **Database**, enter **User name** `netra_bi` and the **Password**, and select **Connect**.
4. Power BI may say the connection isn't encrypted. Our Postgres runs on your own laptop or network without SSL, so select **OK** to connect unencrypted.
5. In **Navigator**, open the list and tick the six views: `bi.bi_traffic_minute`, `bi.bi_freshness`, `bi.bi_incidents`, `bi.bi_decisions`, `bi.bi_kpi_alerts`, `bi.bi_job_runs`. Select **Load**.
6. Rename the six tables to their short names, so the formulas below work as written. In the **Data** pane on the right (called **Fields** in some versions), right-click each table, select **Rename**, and type the name without its `bi` prefix: `bi_traffic_minute`, `bi_freshness`, `bi_incidents`, `bi_decisions`, `bi_kpi_alerts`, `bi_job_runs`.

## 3. Five measures for the KPI cards
A measure is a small formula Power BI recalculates on every refresh. For each one: select the table named first in the list below in the **Data** pane, then on the **Modeling** ribbon select **New measure**, paste the formula into the formula bar at the top, and press Enter.

```
Events per s = VAR m = MAX(bi_traffic_minute[minute]) RETURN DIVIDE(CALCULATE(SUM(bi_traffic_minute[events]), bi_traffic_minute[minute] = m), 60)
```
```
Flagged pct = VAR m = MAX(bi_traffic_minute[minute]) RETURN CALCULATE(100 * DIVIDE(SUM(bi_traffic_minute[flagged_rule]) + SUM(bi_traffic_minute[flagged_ai]), SUM(bi_traffic_minute[events])), bi_traffic_minute[minute] = m)
```
```
Freshness p95 s = VAR m = MAX(bi_freshness[minute]) RETURN CALCULATE(MAX(bi_freshness[freshness_p95_s]), bi_freshness[minute] = m)
```
```
Open incidents = CALCULATE(COUNTROWS(bi_incidents), bi_incidents[status] = "open")
```
```
Firing KPI alerts = CALCULATE(COUNTROWS(bi_kpi_alerts), bi_kpi_alerts[state] = "firing")
```
Tables: the first two in `bi_traffic_minute`, the third in `bi_freshness`, the fourth in `bi_incidents`, the fifth in `bi_kpi_alerts`.

These cover the last finished minute. The dashboard's live KPIs are over the last 60 seconds and update every 5 s, so the two can differ by a few percent.

## 4. Build the page
Select a visual type in the **Visualizations** pane, then drag fields from the **Data** pane into the visual's boxes. Name the page **NETRA Ops**: double-click the page tab at the bottom.

1. **Five cards, along the top.** Five **Card** visuals, one measure each: `Events per s`, `Flagged pct` (already in percent), `Freshness p95 s`, `Open incidents`, `Firing KPI alerts`.
2. **Traffic per minute.** A **Line chart**: X-axis `bi_traffic_minute[minute]`; Y-axis `events`, `flagged_rule` and `flagged_ai`; secondary Y-axis `flagged_share`. On the X-axis, choose `minute` itself rather than its **Date Hierarchy** (use the small arrow next to the field in the X-axis box).
3. **Freshness against the target.** A **Line chart**: X-axis `bi_freshness[minute]` (again `minute`, not the hierarchy); Y-axis `freshness_p95_s` and `target_p95_s`. The target draws as a flat line at 5. Any minute above it broke the SLA (`breach` is true).
4. **Incidents by severity.** A **Clustered bar chart**: Y-axis `bi_incidents[severity]`, X-axis count of `id`, legend `detected_by` (rule or AI). Postgres has severity, not the dashboard's tiers (ACT NOW, ACT SOON, WATCH): the browser works out tiers from the time left on each incident, so this chart shows severity and says so in its title.
5. **Decisions.** A **Clustered bar chart**: Y-axis `bi_decisions[action_id]`, X-axis count of `incident_id`, legend `decision` (approved or rejected).
6. **Job runs.** A **Table**: `bi_job_runs[job]`, `started_at`, `status`, `detail`. Select the `started_at` column header in the table to sort the newest first; failed runs read `failed` in `status` with the reason in `detail`.

## 5. Automatic page refresh, then save
1. Click an empty part of the page, so the page itself is selected and no visual is.
2. In the **Visualizations** pane, select the **Format** button (the paint roller) and find the **Page refresh** card near the bottom. It only appears when the data is connected in DirectQuery: if it is missing, go back to section 2, step 2.
3. Turn **Page refresh** **On**. Choose **Auto page refresh** as the refresh type and set **30 seconds**. The summary is written once a minute, and alerts and job runs change faster, so 30 s is the useful setting.
4. Select **show details** to see the refresh rate Power BI actually achieves.
5. **File** > **Save as**, go to the repository's `bi` folder (create it if needed), and save as **`NETRA_Ops.pbix`**. Power BI keeps the password in its own settings on this laptop, not in the file.

**Present from Power BI Desktop.** In Desktop the page can refresh as often as every second. Published to the Power BI service on a normal (shared capacity, Pro) workspace, the shortest allowed interval is 30 minutes. Only Premium or Fabric capacity allows faster.

## 6. From a second laptop on the same network
On **the laptop running Docker**:
1. Find its address: in a terminal, run `ipconfig` and note the **IPv4 Address** of the Wi-Fi or Ethernet adapter, for example `192.168.1.23`.
2. Make sure the network is set to **Private**, not Public (Windows **Settings** > **Network & internet** > your connection > **Network profile type**). Don't do this on a venue or public Wi-Fi: use a phone hotspot or your own router.
3. Allow Postgres through Windows Firewall. In **PowerShell run as administrator**:
   ```
   New-NetFirewallRule -DisplayName "NETRA Postgres for Power BI" -Direction Inbound -Protocol TCP -LocalPort 5432 -Action Allow -Profile Private
   ```
   After the demo, remove it:
   ```
   Remove-NetFirewallRule -DisplayName "NETRA Postgres for Power BI"
   ```

On **the second laptop**:
4. Check that it can reach Postgres. In PowerShell (not as admin), run `Test-NetConnection 192.168.1.23 -Port 5432` with the first laptop's address. `TcpTestSucceeded : True` means it can.
5. In Power BI Desktop, either build a new report (section 2 onwards, with **Server** `192.168.1.23:5432`), or open a copy of `NETRA_Ops.pbix` and point it at the new server: on the **Home** ribbon open the **Transform data** menu, select **Data source settings**, select the PostgreSQL source, then **Change Source...**, and change the server.

## Troubleshooting
| what you see | why, and what to do |
|---|---|
| No **Page refresh** card | The data is in Import mode. Connect again with **DirectQuery** (section 2). |
| `password authentication failed for user "netra_bi"` | The password differs from `BI_PASSWORD`, or the ops service has not run yet. Check `docker compose logs ops`. |
| The views are empty | The ops service writes a row each minute only while events flow. Check that the generator runs (`make sim`) and look for `bi_rollup` lines in `docker compose logs ops`. |
| Timed out from the second laptop | The firewall rule is missing, the network is set to Public, or the address changed. Repeat section 6. |
| `permission denied for table ...` | You chose a table instead of a view. Only the six `bi.` views are readable. |

---

## The Fabric Real-Time Intelligence path (the cloud version)
The same idea without Postgres in the middle. Microsoft Fabric reads the event stream directly from Redpanda's Kafka-compatible endpoint, stores it in an **Eventhouse** (a KQL database), and shows a **Real-Time Dashboard** that refreshes as data arrives. You need a Fabric workspace with a Fabric capacity or a trial, and Contributor rights in it.

**What Redpanda needs first.** Fabric's Apache Kafka source connects from the cloud. Microsoft's page requires a broker that is **publicly reachable** (not behind a firewall or NAT, unless you set up Eventstream's private network support), with **SASL_SSL** (SASL username and password over TLS; mechanism PLAIN, SCRAM-SHA-256 or SCRAM-SHA-512) or mTLS. Our laptop Redpanda (`--mode dev-container`, plaintext, on a home network) is neither. The usual route is a managed Redpanda cluster with SASL/SCRAM and TLS, to which the simulator and processor publish the same topics. The topics, messages and processor stay unchanged.

1. **Eventstream.** In your Fabric workspace select **+ New item** > **Eventstream**, and name it `netra-events`.
2. **Source.** Select **Connect data sources** (or **Add source** > **Connect data sources** on the ribbon), then **Apache Kafka**. On the **Connect** page select **New connection**:
   - **Bootstrap Server**: your Redpanda's public address, for example `seed-xxxx.redpanda.cloud:9092`.
   - **Connection name**: any name. **Authentication kind**: **API Key**. **Key** and **Secret**: the Redpanda SASL username and password.
   - Select **Connect**, then set **Topic** `events.enriched`, **Consumer group** `fabric-netra`, **Reset auto offset** to the latest, **Security protocol** **SASL_SSL**, and **SASL mechanism** as your cluster uses (Redpanda Cloud uses SCRAM-SHA-256).
   - Our events are JSON, which is the only format Eventstream can preview from Kafka.
3. **Destination.** In **Edit mode** select **Add destination** > **Eventhouse**, choose **Direct ingestion**, enter a **Destination name**, your **Workspace** and **Eventhouse**, select **Save**, connect it to the stream, and select **Publish**. In **Live view**, select **Configure** on the Eventhouse node, choose **New table** (`events`), and follow **Inspect the data** to **Finish**.
4. **Real-Time Dashboard.** **+ New item** > **Real-Time Dashboard**, name it `NETRA live`, then **Add data source** > **KQL Database** and pick the Eventhouse's database. Select **Editing**, then **New visual**, write a KQL query, select **Run**, choose the **Visual type** under **Visual formatting**, and select **Done**. Two starting tiles:
   ```
   events | where todatetime(processed_ts) > ago(1h)
   | summarize events = count(), flagged = countif(rule_hits != "[]") by bin(todatetime(processed_ts), 1m)
   ```
   ```
   events | where todatetime(processed_ts) > ago(1h)
   | summarize p95_s = percentile((todatetime(processed_ts) - todatetime(event_ts)) / 1s, 95) by bin(todatetime(processed_ts), 1m)
   ```
   Adjust the column types to what the table creation in step 3 inferred.
5. **Live refresh.** **Manage** tab > **Refresh settings** > **Live refresh**, choose the rates, select **Done**, then **Save**.

What changes from the laptop version: freshness is measured from `event_ts` to Fabric's ingestion rather than to ClickHouse, and incidents, decisions and job runs (which live in Postgres) need their own path, for example a Postgres CDC source in the same eventstream. That is out of scope for the demo.

## Sources (checked 2026-10-07)
- PostgreSQL connector (Npgsql included, Import or DirectQuery, Database sign-in, the unencrypted prompt): https://learn.microsoft.com/en-us/power-query/connectors/postgresql
- Get data and Navigator in Power BI Desktop: https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-quickstart-connect-to-data
- Measures (**Modeling** > **New measure**, the **Data** pane): https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-measures
- **Transform data** > **Data source settings** > **Change Source...**: https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-data-sources
- Install and version check (**Help** > **About**), minimum requirements: https://learn.microsoft.com/en-us/power-bi/fundamentals/desktop-get-the-desktop
- Automatic page refresh (DirectQuery only, the **Page refresh** card, a 30 minute minimum on shared capacity): https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-automatic-page-refresh
- Fabric Eventstream, Apache Kafka source (public broker, SASL_SSL): https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/add-source-apache-kafka
- Eventstream to Eventhouse: https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/add-destination-kql-database
- Real-Time Dashboard: https://learn.microsoft.com/en-us/fabric/real-time-intelligence/dashboard-real-time-create
