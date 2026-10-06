# NETRA pages

## Routes
| route | page | priority for the mentor demo |
|---|---|---|
| `/live` | Live dashboard | 1 (must be excellent) |
| `/engines/detection` | Detection engine (ATDE), read-only walkthrough | 2 (shows real model output) |
| `/engines/remediation` | Remediation engine (CRIE), read-only walkthrough | 3 |
| `/` | Landing: hero with the globe, how it works, why, enterprise, live | 4 |

Nav (centred glass pill): Dashboard, Engines, Home. The logo links to `/`.

## Principles for every page
- A first-time viewer understands the page in 10 seconds without anyone talking. Each page has one sentence under its title saying what it shows.
- Deliverables first, supporting data second. Size and position follow importance.
- Never an empty state on first load: auto-select the top incident, auto-play the walkthroughs.
- Mock data carries the SIMULATED FEED chip. Anything from the ML team's exports says what it is (for example "output of ATDE v0.1 on held-out test events").
- Quiet by default, alive on contact: details open on hover, focus or click (see DESIGN.md v2).

---

## Boot screen (first visit of the session, before `/live` or `/`)
See DESIGN.md. Real statuses only:
```
WE WATCH THE STREAM.
YOU MAKE THE CALL.
                 [ NETRA logo ]
           REAL-TIME THREAT TRIAGE
CONNECTING TO LIVE FEED ........ OK   (or SIMULATED FEED)
LOADING 26 DETECTION RULES ..... OK
ATDE v0.1 ...................... READY
CRIE ........................... PENDING
[##############......]
```

## 1. Live dashboard (`/live`)
Design: DESIGN.md v2 and the Design canvas board "Dashboard B: focus". Subtitle (screen-reader and tour): "Live incidents, ranked by how bad, how sure and how soon."

### Header
- Left: the live heartbeat trace with LIVE (RECONNECTING, FEED STALLED or FEED DOWN in red), the clock, and the 10-segment freshness meter with "1.4 s / 5 s".
- Centre: the glass nav pill (eye mark, Dashboard, Engines, Home).
- Right: Tour, Expired n, Judged normal n (blue), Simulated feed (dashed) or the signed-in role and Sign out.

### Left: Needs attention (slim, about 268 px)
Tier labels (Act now in rust, Act soon, Watch) with counts. Each row: a dot coloured by time left (ember to ash), the name, the time left in mono; Watch rows dimmed. The selected row has ember light and a rust hairline. Judged normal and Expired stay pinned at the bottom.

### Centre: the incident (the hero card)
- Top: ACT NOW pill (or the tier), "Incident 0131 · opened 10:03 · rules + AI", the name (Geist 300, about 42 px), and who and where (account, addresses, hosts, technique id).
- Top right: the rust **Fix** button with "3 ready". Hover or focus fans the top three fixes; click opens the fixes overlay (three fix cards with Approve fix and Reject). While CRIE is pending it reads "Fix · MITRE" and opens MITRE's standard mitigations.
- Middle: the segmented countdown ring with the time left (last two digits faint) and "cold at 10:13:08"; beside it **How it escalated**: a step chart of attention, one step per signal with "+points" and a short reason (hover a step for the full sentence; a "List" toggle shows every sentence); the evidence bar on the far right.
- Bottom: Severity (bars + 5/5), Attention (100), Risk (0.70, with "severity × attention × urgency").
- A faint ember dot texture fades from the card's top-right corner.

### Centre bottom: four tiles that open upward on hover, focus or click
Threat scope (the radar, sweeping), Who is involved (the entity graph), Detections / min (rules and AI, the chart), System (the health list). Closed, each shows one line or one small drawing.

### Right: Live feed (every event, normal ones included)
The events per second as a big number, the flagged share, a 60-second stacked bar chart (normal grey, flagged by a rule rust, flagged by the AI lilac), and a list of recent events (time, address, what happened, a tag when flagged) where new rows slide in. Pauses while hovered.

### Judged-normal detail
Replaces the hero card when selected: the name, time, sentence and the checks, each with a blue tick. "No incident raised. Nothing for an analyst to do."

### Demo mode (`?demo=1`)
A small glass strip bottom-right: "RUN CREDENTIAL STUFFING", "RUN FLASH CROWD", "STALL FEED", "RESET". Keys: Shift+A, Shift+B, Shift+F, Shift+R. Scripts in DATA_CONTRACT.md. Hidden without `?demo=1`.

---

## 2. Detection engine (`/engines/detection`)
Title "DETECTION ENGINE". Subtitle: "How NETRA catches attacks that rules miss. This walkthrough replays real output from our model."
Read-only; auto-advances through five stages every 5 s and loops. With reduced motion, all stages are stacked and visible.
Layout: stage area (glass, about 70%) + model card (panel, about 30%). A stage rail on top; the current stage is a solid rust chip.
Data: `src/data/fixtures/atde_samples.json`.
1. **A live event arrives**: the raw event's 16 fields as a two-column Plex Mono table, then "features computed from the last few minutes" (the fixture's `features`).
2. **Rules check it first**: "Checked against 26 detection rules." and the rule IDs that fired as violet tags (or "No rule fired."). Then: "Rules only know patterns someone wrote down. The AI engine looks for anything unusual."
3. **Isolation Forest: how unusual is it?** A histogram of anomaly scores for normal traffic (muted bars), the threshold (dashed rust line) and this event's score as a cyan marker.
4. **XGBoost: what kind of attack?** Horizontal probability bars per class: the top class solid cyan, the others faint cyan outlines, values in Plex Mono.
5. **Result**: ATT&CK ID + name, SevBars, confidence, time taken in ms. If the sample has a ground-truth label: "checked against the answer key: correct" (or "incorrect", honestly).
Model card: name and version; training data exactly as `model.trainingData` states it (no hard-coded claims); metrics or "PENDING"; the honest note: "Training labels come from an automated engine, not analyst verdicts. Analyst decisions in NETRA become new training data."

## 3. Remediation engine (`/engines/remediation`)
Title "REMEDIATION ENGINE". Subtitle: "How NETRA chooses a fix, and why it never invents one." Same structure. Data: `src/data/fixtures/crie_samples.json`.
1. **An incident is confirmed**: a compact glass summary (name, ATT&CK ID, severity, key features).
2. **One model per fix**: 10 to 15 horizontal cyan bars, one per approved action, each from its own LightGBM model, with the threshold line.
3. **The top 3 go to an analyst**: the top three stay lit, the rest fade to stale grey.
4. **Why this fix**: a SHAP waterfall for the top fix (positive contributions solid cyan, negative outlined), plain-language labels.
5. **When nothing is confident**: a second sample below the threshold; NETRA says so and shows MITRE's mitigation table.
6. **Every decision teaches it**: a loop diagram (approve or reject, stored, used in the next retraining) with the counts in green and muted.
Model card: action list size, D3FEND mapping, metrics (Precision@3, analyst acceptance rate) or "PENDING", and: "Every fix comes from a fixed, vetted list. No generative model makes decisions."

---

## 4. Landing (`/`)
Design: the Design canvas board "Landing page", with the globe kept.
- **Header:** the eye mark and NETRA, links (How it works, Why NETRA, Enterprise, Live dashboard), Sign in on the real backend. No call-to-action button in the header.
- **Hero:** a small pill ("Real-time security risk, ranked by the time left to act"); the headline "Security decisions while the data is still warm." with "still warm." in an ember gradient; the cooling-words line ("NETRA ranks threats by time left", "puts rules and AI side by side", "explains every score", "waits for a person to approve", "proves its data is fresh", "turns noise into incidents"); two buttons (See it live, How it works). Right: the dotted globe turning slowly, YOUR NETWORK marked. Behind: one slow ember ribbon.
- **The one particle moment:** scrolling from the hero, the globe's dots break apart and re-form as the dashboard's outline, which hands over to a real screenshot-style product shot.
- **How it works:** five cards (Ingest, Detect, Correlate, Prioritise, Recommend); each drawing comes alive on hover or focus.
- **Why NETRA:** six short novelties in a grid.
- **Enterprise:** freshness SLA, load test, failure alerting, Power BI. Numbers only from docs/SLA.md and docs/LOAD_TEST.md; until then "[measured p95]" style placeholders.
- **Live:** "Watch the data cool." and the live dashboard itself embedded below.
- The globe's locations are illustrative; never name real places as attack sources.
