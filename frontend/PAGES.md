# NETRA pages

## Routes
| route | page | priority for the mentor demo |
|---|---|---|
| `/live` | Live dashboard | 1 (must be excellent) |
| `/engines/detection` | Detection engine (ATDE), read-only walkthrough | 2 (shows real model output) |
| `/engines/remediation` | Remediation engine (CRIE), read-only walkthrough | 3 |
| `/` | Landing with the 3D iris | 4 (polish; has a static fallback) |

Top bar nav labels: "live dashboard", "detection engine", "remediation engine". The NETRA wordmark links to `/`.

## Principles for every page
- A first-time viewer understands the page in 10 seconds without anyone talking. Every page has one sentence under its title saying what it shows.
- Deliverables first, supporting data second. Size and position follow importance, not the order things were built.
- Never an empty state on first load: auto-select the top incident, auto-play the walkthroughs.
- Anything from mock data is labelled "simulated feed". Anything from the ML team's exports is real and says so (for example "output of ATDE v0.1 on held-out test events").

---

## 1. Live dashboard (`/live`)
Subtitle: "Live incidents, ranked by danger and by how much time is left to act."

### Top bar status strip (right side of the top bar)
- Feed status: StatusDot + "live" / "stalled" / "down"
- Freshness: "1.8 s" in mono, then "of 5 s target" in taupe. This is our freshness SLA: time from an event arriving to a ranked alert on screen. Turns signal red with text "over target" if p95 exceeds 5 s.
- "3 expired today" (click scrolls the queue to the expired group)
- "2 judged normal" (click scrolls the queue to the judged-normal group)
- "simulated feed" chip while `VITE_DATA_SOURCE=mock`

### Left module: needs attention (380px)
Meta text: "sorted by attention score and time left" with a Glossary "?" that says: "Attention score is how strong the evidence is. As an incident's time runs out, it moves up the list."
Each row (a tile, 72px tall):
- attention score 0 to 100 (mono-lg)
- attack name (ui) and ATT&CK ID (mono chip)
- detected by: small icon + "rule" or "AI engine"
- SevMeter (compact, no text)
- HeatBar + Countdown (mm:ss)
Selected row is the inverted tile. Rows reorder live with the layout animation.
Below the open incidents, two collapsible groups:
- **judged normal (n)**: spikes the system noticed and decided were not attacks (flash crowd, nightly backup). Taupe rows, name plus one-line reason. Selecting one shows the judged-normal detail (below). This group is a feature, not a footnote: it proves NETRA does not cry wolf.
- **expired today (n)** in ash. Expired incidents stay listed: counted, never hidden.

### Centre module: incident detail
1. **Header band** (tiles side by side)
   - Left tile: incident name (h1), ATT&CK technique ID + name in mono, "detected by", first seen / last seen timestamps in mono. Below the name, two labelled readouts side by side, each answering its own question:
     - "severity" (how bad if it is real): SevMeter with "sev 4"
     - "attention score" (how strong the evidence is): the number in Archivo 125%, 700, plus "of 100"
   - Right tile (heat tile): label "time left to act", Countdown at readout size, full-width HeatBar, "goes stale at 14:32:10" in mono. The fill of this tile is the heat colour.
2. **How it escalated** (tile, left, about 60% width): the signals in time order, as a vertical list of steps. Each step shows: time (mono), rule ID chip (mono, e.g. "CS-2", or "AI engine"), the plain sentence from the templates in DATA_CONTRACT.md, and its points ("+20", mono). A thin running-total bar beside the list climbs with each step to the attention score, with tick marks at 30 (suspicious) and 60 (critical). This makes the score explain itself: the viewer sees exactly which evidence added up to it. Levels are shown by the bar and a text label, not by colour.
3. **Who is involved** (tile, right, about 40%): Cytoscape graph of IPs, users and hosts in this incident, target account in the centre.
4. **Recommended fixes** (full width, three tiles in a row, ranked 1 to 3):
   - rank, action name (Archivo 600), D3FEND technique name (mono, taupe)
   - confidence: thin cream bar + value in mono
   - "why": the 3 biggest reasons as plain sentences with small contribution bars and signed values in mono, e.g. "login from a country this user never used  +0.31"
   - buttons: "Approve fix" (primary) and "Reject" (secondary)
   - after Approve: tile turns inverted with "approved" and a timestamp; toast "Fix approved. Saved as training data for both engines."
   - fallback state: if no fix passes the confidence threshold, one full-width tile says "No fix was confident enough. Showing MITRE's standard mitigations for T1110." and lists them in mono.

### Judged-normal detail (centre module, when a judged-normal row is selected)
Header: name ("Flash crowd"), time, and the sentence ("Traffic up 4x, but users, paths and success rate look normal."). Then the checks from the rules document as a list, each with a check icon and plain text: "traffic spike detected", "user distribution looks normal", "requested paths look normal", "login success rate looks normal". Closing line in taupe: "No incident raised. Nothing for an analyst to do." No fixes, no heat, no countdown.

### Right module: system health (300px)
Subtitle in taupe: "Can you trust what you are seeing?"
- Freshness sparkline (last 5 minutes of p95 latency) with a horizontal 5 s target line
- Events per second (mono) and "events checked today"
- Detected by: a two-part bar, rule vs AI engine, with counts
- Models: ATDE and CRIE, each with version, trained date, status
- Retraining: last run, next scheduled run, status
- Pipeline alerts: empty state "No pipeline problems." When failing: signal red StatusDot + plain sentence + time
- Analyst decisions today: approved / rejected counts (this is the learning loop, visible)

### Demo mode (for presentations)
With `?demo=1` in the URL, a small unobtrusive control strip appears at the bottom right (panel-2, mono 12px):
- "run credential stuffing" plays the scripted scenario from DATA_CONTRACT.md
- "run flash crowd" plays the benign spike that NETRA judges normal
- "stall feed" simulates the feed stopping for 15 s (shows the failure alerting working)
- "reset"
Keyboard: Shift+A runs the attack, Shift+B runs the flash crowd, Shift+F stalls the feed, Shift+R resets. Hidden entirely without `?demo=1`.

---

## 2. Detection engine (`/engines/detection`)
Title: "Detection engine". Subtitle: "How NETRA catches attacks that rules miss. This walkthrough replays real output from our model."
Read-only. It auto-advances through five stages every 5 s and loops. With reduced motion, all stages show at once, stacked.

Layout: stage area (left, about 70%) + model card (right, about 30%). A stage rail on top shows the five stage names; the current one is the inverted chip.

Stages (data from `src/data/fixtures/atde_samples.json`, cycling through samples):
1. **A live event arrives**: the raw event's 16 fields as a two-column mono table (field name, value), exactly as the generator sends them. Underneath, "features computed from the last few minutes": the `features` object from the fixture, with plain labels.
2. **Rules check it first**: "Checked against 26 detection rules." then the rule IDs that fired as chips (from `rules.fired`), or "No rule fired." One line on why the AI engine is still needed: "Rules only know patterns someone wrote down. The AI engine looks for anything unusual."
3. **Isolation Forest: how unusual is it?** Histogram of anomaly scores for normal traffic (taupe bars), threshold line (cream, dashed), this event's score as a marker. One sentence: "Scores above the line are unusual enough to investigate."
4. **XGBoost: what kind of attack?** Horizontal bars of class probabilities, top class cream, others taupe, values in mono.
5. **Result**: ATT&CK ID + name, severity meter, confidence, time taken in ms. If the sample has a ground-truth label from the generator: "checked against the answer key: correct" (or "incorrect", shown honestly).

Model card: model names and versions, the training data exactly as the fixture's `model.trainingData` states it (do not hard-code WitFoo claims: see "ATDE input" in DATA_CONTRACT.md), metrics from the fixture (precision on the malicious tier, recall, scoring latency p95) or "pending", and the honest note: "WitFoo's labels come from an automated engine, not analyst verdicts. Analyst decisions in NETRA become new training data."

---

## 3. Remediation engine (`/engines/remediation`)
Title: "Remediation engine". Subtitle: "How NETRA chooses a fix, and why it never invents one."
Same structure as the detection page: auto-advancing stages + model card. Data from `src/data/fixtures/crie_samples.json`.

1. **An incident is confirmed**: a compact summary tile (name, ATT&CK ID, severity, key features).
2. **One model per fix**: 10 to 15 horizontal bars, one per action in the approved list, each a confidence from its own LightGBM model. Threshold line.
3. **The top 3 go to an analyst**: the top three bars stay, the rest fade to ash.
4. **Why this fix**: SHAP waterfall for the top fix (ECharts bar waterfall, positive contributions cream, negative taupe, values in mono), with plain-language labels.
5. **When nothing is confident**: a second sample where all bars sit below the threshold; NETRA says so and shows MITRE's mitigation table for that technique.
6. **Every decision teaches it**: a simple loop diagram (approve or reject, stored, used in the next retraining) with the approved / rejected counts.

Model card: action list size, D3FEND mapping, metrics (Precision@3, analyst acceptance rate) from the fixture or "pending", and the line "Every fix comes from a fixed, vetted list. No generative model makes decisions."

---

## 4. Landing (`/`)
The only place with spectacle. Must never block the demo: if the Spline scene fails or is slow, show `public/brand/hero-fallback.jpg`.

- Hero (100vh): the Spline glass iris centred, the glass NETRA logo (`netra-glass.png`) above or beside it, one line in Archivo 125%: "Security decisions while the data's still warm." Button: "Open live dashboard".
- Scroll story (Lenis smooth scroll, scroll progress drives the Spline rings): five steps, one per ring. As each ring separates or rotates into place, its text appears on the left:
  1. Ingest: every login, web request and network flow, streamed live.
  2. Detect: rules catch known attacks instantly; the AI engine catches what rules miss.
  3. Correlate: small warning signs from one source merge into one incident.
  4. Prioritise by time left: every incident gets a deadline before its data goes stale.
  5. Recommend: the top 3 fixes, explained, and nothing runs until an analyst approves.
  This IS a sequence, so the steps are numbered.
- Closing band: "Built on Microsoft Azure, ONNX Runtime and LightGBM from Microsoft Research." as plain text, then the button again.

Spline wiring: the scene objects are named `ring_1` to `ring_5` and `pupil`. Use the `onLoad` callback of `@splinetool/react-spline` to get the app, `app.findObjectByName("ring_1")` etc., and set their rotation and position from scroll progress (0 to 1). Lazy-load the whole landing route.
