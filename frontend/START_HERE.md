# NETRA frontend: start here

Goal for tomorrow at 2: a live dashboard that tells the whole story on its own, plus an engine page showing real output from the base model. The 3D landing page is the bonus, not the foundation.

Rough time budget (about 11 hours of build). Cut from the bottom if you fall behind.

| # | block | time | if behind |
|---|---|---|---|
| 0 | ask the ML pair for their export (backend has replied) | 0:05 | never skip |
| 1 | setup: GitHub Desktop, folder, Claude Code | 0:30 | never skip |
| 2 | design kit: tokens + components, reviewed by you | 1:00 | never skip |
| 3 | data layer + mock engine | 0:45 | never skip |
| 4 | live dashboard: queue + detail + fixes | 3:00 | drop the graph, use a list of entities |
| 5 | system health + demo mode | 1:15 | keep demo mode, simplify health |
| 6 | detection engine page (real model output) | 1:15 | keep, it proves the ML work is real |
| 7 | remediation engine page | 0:45 | reduce to stages 2 and 4 |
| 8 | landing: 5-step globe scroll (timeboxed) | 1:30 | step 1 only (static globe hero), then fallback image |
| 9 | critique and polish | 1:00 | 30 min minimum |
| 10 | rehearsal + backup recording | 0:45 | never skip |

---

## 0. Message your teammates now (copy-paste)

To the ML pair:
> For the mentor demo I'm showing real ATDE output in the UI. Tonight, can you export from base model 1 a JSON in the shape of `atde_samples.json` (I'll send the file): about 20 test events with their features, Isolation Forest anomaly score, XGBoost class probabilities, predicted class, true label from the generator, and scoring time in ms. Also the anomaly score histogram on normal traffic (bin edges + counts + threshold), and any validation metrics with exactly how you computed them. Put "source": "model-export". If CRIE isn't trained yet, that's fine, I'll show it as pending.

To the backend pair:
> For the frontend contract: send me one real event as JSON (exact field names), the list of attack types the generator produces right now, the stale-by window per attack type from the design note, whether the WebSocket is up and its URL, and who measures freshness latency.

Send them `docs/DATA_CONTRACT.md` too. When their answers arrive, paste them into your troubleshooter chat and ask it to update the contract.

---

## 1. Setup (30 min)

1. Install **GitHub Desktop** (desktop.github.com) and sign in with your GitHub account. It handles all the Git commands you'd otherwise type.
2. Ask your backend lead: "Do we already have a team repo?"
   - **Yes**: in GitHub Desktop, File > Clone repository, pick it. Inside it, create a folder called `frontend`. That folder is your project.
   - **No**: File > New repository, name it `netra`, choose a location, tick "Initialize with a README", Create. Then click "Publish repository" (keep it private for now). Create a `frontend` folder inside it.
3. Copy everything from this kit into the `frontend` folder: `CLAUDE.md`, `START_HERE.md`, `docs/`, `src/data/fixtures/`.
4. Export your logo from Figma into `frontend/public/brand/netra-logo.svg`: NETRA in Yapari, rust `#FF4A26`, and "नेत्र" as a small subtitle, on a transparent background. Outline all text before exporting. Keep it flat: the glass and dispersion now live in the UI's glass cards, so a flat logo reads more crisply on top of them.
   - Note on Yapari: trial licences usually allow testing only, not published or presented work. Read its licence before the final round. If it doesn't allow this, Michroma is already in the system and makes a good fallback wordmark.
5. Open the Claude Code desktop app and point it at the `frontend` folder (not the repo root). Claude Code reads `CLAUDE.md` automatically at the start of every session.

---

## 2 to 9. Build, one prompt at a time

Rules for yourself:
- Paste one prompt, let it finish, check the browser, then commit (in GitHub Desktop: write a summary, "Commit to main", then "Push origin" every hour or so).
- If something looks wrong, paste a screenshot into Claude Code and say what is wrong in design terms ("the countdown is fighting the title for attention").
- If Claude Code fails at the same thing twice, stop. Open GitHub Desktop, right-click the files under "Changes" and discard them to go back to your last commit, then ask your troubleshooter chat.

### Prompt A: plan first
> Read CLAUDE.md, docs/DESIGN.md, docs/PAGES.md and docs/DATA_CONTRACT.md. Don't write code yet. Give me your build plan for today in 8 bullets following START_HERE.md, and list anything in the docs that is unclear or contradicts itself.

Answer its questions, then continue.

### Prompt B: scaffold
> Scaffold the app in this folder with Vite, React and TypeScript (strict). The folder already contains CLAUDE.md, START_HERE.md, docs/ and src/data/fixtures/: keep them. Install exactly the packages listed in CLAUDE.md. Create src/styles/tokens.css exactly as in docs/DESIGN.md, plus global.css (grain overlay, base type, focus ring, reduced-motion rules) and fonts.ts. Build the AppShell with the top bar (wordmark from public/brand/netra-wordmark.svg, the three nav links, an empty status strip on the right) and routes for the four pages with placeholder text. Lazy-load the landing route. Run npm run build, then tell me the command to open it.

Then in the Claude Code terminal (or ask it to run it): `npm run dev`, and open http://localhost:5173/live

### Prompt C: design kit (this is where you act as the designer)
> Build the materials and base components from docs/DESIGN.md, using docs/reference/dashboard.html for exact values: PixelField (low-res canvas, drifting blobs, 15 fps, static with reduced motion) with the CSS glow behind it, ScanlineOverlay, GlassCard, Panel (bracket title, meta, corner ticks), NumText (Doto with IBM Plex Mono punctuation), QueueRow (default, selected, going cold, WATCH dimmed), TierHeader, HeatSegments (all heat states), CountdownRing, AttentionGauge, SevBars, RiskReadout, SourceTag, Chip, Button (approve, reject, primary), plus src/lib/heat.ts, src/lib/rank.ts (test it against the worked examples in DATA_CONTRACT.md), src/lib/family.ts and src/lib/echartsTheme.ts. Add a temporary route /kit showing every component in every state on top of the pixel field, so I can review the whole system at once.

Open /kit. Spend 20 minutes here: glass strength, the pixel field's brightness and speed, the heat colours, the Doto numbers. Compare against `docs/reference/dashboard.png`. Every fix here is inherited by every page. Commit.

### Prompt D: data
> Implement src/data/types.ts, the DataSource interface, mockEngine.ts (background behaviour only, no scenario yet) and the zustand store, exactly as in docs/DATA_CONTRACT.md. Show the "simulated feed" chip in the top bar when the source is mock. Add a tiny debug line on /kit showing how many incidents are open, so I can see the engine running.

### Prompt E: dashboard layout and queue
> Build the boot screen and the live dashboard at /live: the layout from docs/DESIGN.md and docs/reference/dashboard.png (glass top bar with the OSD, left queue, centre, right column), then the NEEDS ATTENTION queue exactly as in docs/PAGES.md, grouped into ACT NOW / ACT SOON / WATCH using src/lib/rank.ts, with live reordering, heat segments, going-cold chips, and the judged-normal and expired groups. Auto-select the top incident.

### Prompt F: incident detail
> Build the centre of the dashboard from docs/PAGES.md: the glass incident focus card (name, chips including the rules + AI split chip, SevBars, AttentionGauge, RiskReadout with the formula, CountdownRing), the HOW IT ESCALATED panel with source-coloured tags and the EvidenceBar, and the WHO IS INVOLVED Cytoscape graph styled as in docs/DESIGN.md.

### Prompt G: recommended fixes
> Build RECOMMENDED FIXES from docs/PAGES.md: three glass FixCards (rank badge, cyan confidence ring, "WHY THE AI PICKED IT" with cyan reason bars, APPROVE FIX in green and REJECT), the approved state, the toast, the fallback card and the CRIE-pending state. Approve and Reject update the decisions count in the store.

### Prompt H: right column
> Build the right column from docs/PAGES.md and docs/DESIGN.md: THREAT SCOPE (SVG radar with family sectors from src/lib/family.ts, blips by time left, attention and heat, the rotating sweep, the selected-incident bracket and trail, click to select; take the maths from docs/reference/dashboard.html), DETECTIONS / MIN (ECharts stacked violet and cyan bars with our theme and the ATTACK STARTS marker), and SYSTEM (status rows, green freshness sparkline, pink failure state).

### Prompt I: demo mode
> Add demo mode exactly as described in docs/PAGES.md and the three scripted scenarios in docs/DATA_CONTRACT.md (credential stuffing into account takeover, flash crowd, feed failure), with the keyboard shortcuts. Only active with ?demo=1.

Rehearse it once: open /live?demo=1, press Shift+A and watch the story play out, then Shift+B and check that the flash crowd lands in "judged normal" with no incident.

### Prompt J: detection engine page
Put the ML team's `atde_samples.json` into `src/data/fixtures/` first (keep the example file if theirs hasn't arrived).
> Build /engines/detection from docs/PAGES.md using src/data/fixtures/atde_samples.json. Show whatever features the fixture lists; don't hard-code any training data claims. Respect the "source" field: show "example data" when it is "example" and the model version when it is "model-export". Missing metrics show "pending".

### Prompt K: remediation engine page
> Build /engines/remediation from docs/PAGES.md using src/data/fixtures/crie_samples.json, with the same source and pending rules.

### Prompt L: critique before polish
> Review every page against docs/DESIGN.md, especially the anti-patterns list and the three questions a first-time viewer must answer. Don't change anything yet. Give me the 10 biggest problems, ranked by how much they hurt understanding, with the fix for each.

Pick what to fix, then ask it to fix those only. Delete the /kit route at the end (or hide it).

---

## 8. Landing page: the 5-step globe scroll (timebox 90 minutes)

No Spline and no 3D library: the globe is drawn with d3-geo on a canvas and the network steps are SVG, so it's light and reliable. Claude Code writes it; your job is art direction at each checkpoint.

### Prompt M: landing, step 1 first
> Build the landing page from docs/PAGES.md section 4. Start with step 1 only, matching docs/reference/landing-step1.png and reusing the globe code in docs/reference/landing-step1.html (dotted land from world-atlas, arcs, HUD, halo), but as proper components: a canvas Globe that rotates slowly, the glass top bar, the left copy and caption card, the corner HUD readouts from the store, the step counter and the step rail. Lazy-load the route, cap the pixel ratio at 1.5. Stop so I can review.

Then, one prompt per step:
> Add step 2 (DETECT) from docs/PAGES.md, driven by scroll progress with useScroll from motion. Stop for review.

Repeat for steps 3, 4 and 5. After step 1 looks right, save a screenshot as `public/brand/hero-fallback.png`.

If 90 minutes pass and the steps aren't working, stop. Keep step 1 as a static hero, which is already strong on its own. The mentor is judging the dashboard.

## 10. Morning of the presentation

1. Pull the latest code (GitHub Desktop, "Fetch origin", then "Pull").
2. Run `npm run build` then `npm run preview`, and present from that address, not from dev mode.
3. Open `/live?demo=1` in a fresh browser window. Zoom to 100%. Close other tabs, turn notifications off.
4. Record a 2-minute backup video of the full demo (Windows: Win+Alt+R with Xbox Game Bar; Mac: Cmd+Shift+5). If Wi-Fi, the projector or the laptop fails, you play this.
5. Rehearse the click path: landing (10 s) > live dashboard > Shift+A > walk the incident from queue to fixes > Approve fix > Shift+F to show failure alerting > detection engine page.

## How to present the design to your mentor (3 sentences)
> "We designed NETRA like an instrument panel, not a web app: everything is opaque and quiet, so colour can carry meaning. There is exactly one colour story, heat, which shows how fresh each incident's data still is, because acting while the data is still warm is the whole point of Problem 34. Red means only one thing: our own pipeline is failing."
