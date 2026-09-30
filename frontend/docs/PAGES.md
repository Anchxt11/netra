# NETRA pages

## Routes
| route | page | priority for the mentor demo |
|---|---|---|
| `/live` | Live dashboard | 1 (must be excellent) |
| `/engines/detection` | Detection engine (ATDE), read-only walkthrough | 2 (shows real model output) |
| `/engines/remediation` | Remediation engine (CRIE), read-only walkthrough | 3 |
| `/` | Landing with the 5-step globe scroll | 4 (polish; has a static fallback) |

Top bar nav: "LIVE DASHBOARD", "DETECTION ENGINE", "REMEDIATION ENGINE". The logo links to `/`.

## Principles for every page
- A first-time viewer understands the page in 10 seconds without anyone talking. Each page has one sentence under its title saying what it shows.
- Deliverables first, supporting data second. Size and position follow importance.
- Never an empty state on first load: auto-select the top incident, auto-play the walkthroughs.
- Mock data carries the SIMULATED FEED chip. Anything from the ML team's exports says what it is (for example "output of ATDE v0.1 on held-out test events").
- Glass for focus and decisions, opaque panels for data (see DESIGN.md).

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
Visual target: `docs/reference/dashboard.png`. Subtitle (screen-reader and first-run hint): "Live incidents, ranked by how bad, how sure and how soon."

### Top bar (glass, full width, 56px, radius 18)
- Left: logo image. Centre-left: nav in a dark pill, the active item solid rust.
- Right, the OSD:
  - green pulsing dot + "LIVE" (pink "FEED STALLED" or "FEED DOWN" on failure)
  - clock in Doto
  - "FRESHNESS" label, a 10-segment green gauge (lit share = p95 / 5 s target) and "1.8S/5S". Turns pink with "OVER TARGET" if p95 exceeds 5 s. This is our freshness SLA: time from an event arriving to a ranked alert on screen.
  - chips: "EXPIRED 3", "JUDGED NORMAL 1" (green), "SIMULATED FEED" (dashed, muted, mock only). The first two scroll the queue to their groups.

### Left: `[ NEEDS ATTENTION ]` (panel, 356px)
Meta: "RANKED BY RISK ?" where the "?" opens: "Risk is how bad, times how sure, times how soon. Incidents move up as their time runs out."
Three TierHeaders (ACT NOW rust, ACT SOON text-hi, WATCH muted), each with a Doto count and a rule to the edge. Empty tiers show "NONE". Logic: DATA_CONTRACT.md, "Ranking".
QueueRow (58px, radius 12):
- attention score (Doto 24)
- name (Chakra Petch 600) over a source tag (RULE violet or AI cyan) and the ATT&CK ID (Plex Mono, muted)
- 16 heat segments and the time left (Plex Mono). Going cold: the time becomes a solid rust chip.
- WATCH rows at 62% opacity.
The selected row is the rust gradient block. Rows reorder live, including between tiers.
Pinned to the bottom:
- **JUDGED NORMAL (n)** in green, with the latest one inline ("Flash crowd, 14:12"). Selecting it opens the judged-normal detail. It proves NETRA doesn't cry wolf.
- **EXPIRED (n)** in stale grey, collapsible. Counted, never hidden.

### Centre top: incident focus (glass, 722 x 212)
- Bracket label `[ INCIDENT 0142 ]` + "OPENED 14:27:12".
- Name in Michroma 21, uppercase, two lines max.
- Chips: detected-by, tinted by source: "DETECTED BY RULES" (violet), "DETECTED BY AI" (cyan), or "DETECTED BY RULES + AI" (a split chip, violet then cyan). Then the ATT&CK ID, user and address count.
- Three readouts in a row, each answering its own question:
  - SEVERITY (how bad if real): SevBars + "SEV 5"
  - ATTENTION (how strong the evidence is): AttentionGauge ring + Doto value "/100"
  - RISK: Doto value, the tier chip (solid rust for ACT NOW), and the formula in muted Plex Mono: `= SEV 5/5 × ATTN 1.00 × URGENCY 0.52`
- Right side: CountdownRing (184px): "TIME LEFT", the Doto countdown, "STALE AT 14:37:12". Ring colour = heat.

### Centre middle
- **`[ HOW IT ESCALATED ]`** (panel): meta "5 SIGNALS, 2 ENGINES". Rows: time, source-coloured tag (rule ID in violet, or "ATDE" in cyan), the plain sentence from DATA_CONTRACT.md, "+20". On the right, the EvidenceBar: stacked segments coloured by source, climbing to the attention score, with dashed marks at 30 (suspicious) and 60 (critical). The score explains itself.
- **`[ WHO IS INVOLVED ]`** (panel): Cytoscape graph as in DESIGN.md, with a legend (ADDRESS, USER, HOST).

### Centre bottom: `[ RECOMMENDED FIXES ]`
Meta: "FROM A FIXED LIST OF 14, NOTHING RUNS WITHOUT APPROVAL". Three glass FixCards:
- rank badge (rank 1 solid rust), action name (Chakra Petch 700, uppercase), "D3FEND: technique name" (Plex Mono, muted)
- confidence ring in cyan with the value (this number comes from CRIE)
- label "WHY THE AI PICKED IT" in cyan, then the top 2 or 3 reasons as sentences with cyan contribution bars and signed values
- "APPROVE FIX" (green) and "REJECT" (outline)
- After approval: the card gets a green outline and "APPROVED 14:33:02"; toast "Fix approved. Saved as training data for both engines."; the SYSTEM approved count increments.
- Fallback: if no fix passes the threshold, one wide glass card: "No fix was confident enough. Showing MITRE's standard mitigations for T1110." with the list.
- While CRIE is pending: the cards show "CRIE PENDING" in muted and the MITRE fallback list, honestly.

### Judged-normal detail (replaces the centre when a judged-normal item is selected)
Glass card: name ("Flash crowd"), time, the sentence ("Traffic up 4x, but users, paths and success rate look normal."), then the checks from the rules document, each with a green check: "traffic spike detected", "user distribution looks normal", "requested paths look normal", "login success rate looks normal". Closing line in muted: "No incident raised. Nothing for an analyst to do."

### Right column
- **`[ THREAT SCOPE ]`** (panel, 310 x 344): see DESIGN.md. Meta: "7 OPEN". Clicking a blip selects the incident.
- **`[ DETECTIONS / MIN ]`** (panel, 310 x 204): meta "LAST 30 MIN"; chips "RULES 41" and "AI ENGINE 17"; stacked bars; the "ATTACK STARTS" annotation for the selected incident.
- **`[ SYSTEM ]`** (panel): meta "CAN YOU TRUST THIS?". Rows with status dots:
  - Live feed, "212 EVENTS/S"
  - Freshness p95, a green sparkline, "1.8S/5S"
  - ATDE detection model, "v0.1 READY"
  - CRIE remediation model, "PENDING"
  - Next retraining, "02:00"
  - Fixes approved today, "12 / 2 REJECTED"
  - Any pipeline problem replaces the first row with a pink status and a plain sentence.

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

## 4. Landing (`/`): the 5-step globe scroll
Visual target for step 1: `docs/reference/landing-step1.png`. Its HTML source has working globe code (d3-geo orthographic projection, dotted land from `world-atlas`, arcs, HUD).
No Spline and no three.js. The stage is a sticky, full-height canvas plus SVG, driven by scroll progress (`useScroll` from `motion`). Lenis smooth scroll is optional.

### Layout (every step)
- Glass top bar: logo, LIVE dot, "HOW IT WORKS", "ENGINES", solid rust "OPEN LIVE DASHBOARD".
- Left column: bracket label `[ 01 / 05 ] INGEST`, the Michroma headline (step 1 only), and a glass caption card that changes per step.
- Right: the stage (about 760 x 760), with HUD readouts in the four corners (Doto numbers, Plex Mono labels) fed from the live store: EVENTS / S, SOURCES SEEN, DETECTION RULES, ATDE MODEL.
- A vertical step counter (01 to 05, current one solid rust) and a bottom step rail with five labelled progress bars.

### The five steps (scroll progress 0 to 1, one fifth each)
1. **INGEST**: the dotted globe (rust pixel squares for land, fading toward the edge, faint graticule, a halo and a tick ring, HUD brackets) rotates slowly. Dashed rust arcs carry small pale-yellow event squares (heat-1, because the data is fresh) from sources around the world to the crosshair labelled "YOUR NETWORK". Headline: "SECURITY DECISIONS WHILE THE DATA IS STILL WARM." Caption: "Every login, web request and network flow streams in live. Scroll to follow one attack from first signal to approved fix."
2. **DETECT**: the globe scales up and fades as the view dives into the crosshair. An isometric wireframe of the network (four host blocks labelled `web-01`, `web-02`, `auth-01`, `db-01` on a grid, in the Super Terrain style) takes its place. One incoming stream turns bright yellow (heat-1); a bracket locks onto it with a violet "RULE CS-1" tag, then a cyan "AI ENGINE 0.81" tag. Caption: "Rules catch known attacks instantly. The AI engine catches what rules miss."
3. **CORRELATE**: six address nodes appear around `auth-01` and lines draw to one account, drawn exactly like the dashboard's WHO IS INVOLVED graph (target solid rust). Caption: "Small warning signs from one source merge into one incident."
4. **PRIORITISE BY TIME LEFT**: the dashboard's CountdownRing wraps the target and drains, and its tier chip flips WATCH, then ACT SOON, then ACT NOW as time runs out. Caption: "Every incident gets a deadline before its data goes stale. The closer it gets, the higher it climbs."
5. **RECOMMEND**: a glass FixCard slides in (1 ENABLE MFA, cyan 0.88 ring, two cyan reasons). The APPROVE FIX button presses itself, the card turns green-outlined with "APPROVED", and the final CTA appears: "OPEN LIVE DASHBOARD". Caption: "The top 3 fixes, explained. Nothing runs until an analyst approves."
Closing band: "Built on Microsoft Azure, ONNX Runtime and LightGBM from Microsoft Research."

### Build notes
- Globe: `d3-geo` (`geoOrthographic`, `geoContains`, `geoInterpolate`, `geoGraticule10`), `topojson-client`, and `world-atlas/land-110m.json`. Precompute the land dots once (about 2,000 squares at a 1.9° step), then draw on canvas each frame while rotating.
- The target's location on the globe is illustrative (the generator has no geolocation). Don't label real cities as attack sources.
- Performance: render only while the stage is on screen, cap the device pixel ratio at 1.5, and lazy-load the route.
- Reduced motion or a slow device: show the five steps as five static frames stacked vertically, each with its caption.
- Fallback image: `public/brand/hero-fallback.png` (a screenshot of step 1).
