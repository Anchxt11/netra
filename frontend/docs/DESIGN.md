# NETRA design system: "phosphor glass"

## Direction in one paragraph
NETRA is a retro security console built with modern materials: rust and black, a slow pixel-dot field glowing behind glass, bracket-framed instrument modules, circular gauges and a radar scope. References: Netflix84 (red CRT mood, boot screen), the resource-overview heatmap (dot-matrix numerals, bracket labels, warm stacked bars), the green Earth scan (HUD brackets, crosshairs, radar), and the modern glass dashboards (rounded cards, one strong accent per action).

The visual targets are `docs/reference/dashboard.png` and `docs/reference/landing-step1.png`. Their HTML sources (`docs/reference/*.html`) contain the exact CSS for glass, panels, the pixel field and the radar maths. They are references to copy values from, not production code.

Two rules keep it smart:
1. **Glass is for focus and decisions; opaque panels are for reading data.** Glass: top bar, incident focus card, fix cards, landing copy cards. Opaque: the queue, escalation list, graph, scope, charts and system module. Nothing dense ever sits on a moving background.
2. **Every colour has exactly one job.** Rust and black carry the brand. Every other hue means one thing, everywhere.

Every screen still answers three questions for a first-time viewer:
1. What needs my action right now?
2. How much time do I have?
3. Why does the system think so, and can I trust it?

## Colour tokens (`src/styles/tokens.css`, paste exactly)
```css
:root {
  /* brand and surfaces */
  --bg:        #0B0605;
  --rust:      #FF4A26;   /* brand, selection, primary action, ACT NOW */
  --rust-2:    #E63A1C;   /* end of the selected-row gradient */
  --text-hi:   #FFF1EA;   /* headings, key numbers */
  --text:      #F5E3DC;   /* body and data */
  --muted:     #A8796C;   /* labels, secondary, "PENDING" */
  --line:      rgba(255, 96, 64, 0.14);  /* panel borders, dividers */

  /* heat = time left to act (warm = fresh). Only on time elements. */
  --heat-1:    #FFD95A;   /* more than 66% of the window left */
  --heat-2:    #FF9A3C;   /* 33 to 66% */
  --heat-3:    #F0502A;   /* 15 to 33% */
  --heat-4:    #A3261A;   /* under 15%: going cold */
  --stale:     #4A3F3C;   /* expired */

  /* who found it (cool = the machines) */
  --rule:      #A98BFF;   /* detected by a rule */
  --ai:        #52D8FF;   /* produced by an ML model (ATDE detections, CRIE confidence, SHAP) */

  /* system state */
  --ok:        #3CF29B;   /* healthy, live, judged normal, approve */
  --fail:      #FF3D7F;   /* our own pipeline is failing. Nothing else is this colour. */

  /* materials */
  --panel:        rgba(12, 6, 5, 0.80);
  --glass-fill:   linear-gradient(140deg, rgba(255,120,90,.11), rgba(255,120,90,.025) 60%), rgba(26,11,9,.46);
  --glass-border: rgba(255, 150, 120, 0.20);
  --glass-hi:     inset 0 1px 0 rgba(255, 210, 190, 0.10);
  --glass-blur:   blur(18px) saturate(140%);

  /* type */
  --font-display: "Michroma", sans-serif;          /* incident names, headlines */
  --font-ui:      "Chakra Petch", system-ui, sans-serif;
  --font-data:    "IBM Plex Mono", ui-monospace, monospace;
  --font-num:     "Doto", "IBM Plex Mono", monospace;  /* big numerals only */

  /* geometry: radius encodes the material */
  --r-glass: 22px;  --r-panel: 18px;  --r-row: 12px;  --r-btn: 10px;  --r-chip: 999px;
  --gap: 12px;  --page-pad: 14px;
}
```

### Colour roles (never mix them)
| colour | means | appears on |
|---|---|---|
| rust | brand, the selected thing, primary action, ACT NOW | logo, selected row, active nav, ACT NOW chip and tier, attention gauge, rank 1 badge |
| heat 1 to 4, stale | time left to act | queue heat segments, countdown ring, scope blips, the going-cold chip |
| violet | a rule detected it | RULE tags, rule signals, rule bars in the detections chart |
| cyan | an ML model produced it | AI tags, AI signals, AI bars, fix confidence rings, SHAP bars |
| green | healthy, live, judged normal, approve | LIVE dot, system status, freshness gauge, Approve button, judged-normal group |
| pink | our pipeline is failing | feed down, SLA breached, retraining failed |

Tier headers: ACT NOW in rust, ACT SOON in `--text-hi`, WATCH in `--muted`. (Tiers are urgency, not time left, so they don't borrow heat colours.)
Severity has no colour: cream bars plus "SEV 4".

Contrast on `--bg`: text-hi about 18:1, text about 16:1, muted about 5:1, rust about 5.9:1, cyan about 12:1, violet about 7:1, green about 13:1. Body text and data are never rust.

## Typography
- **Logo**: an image (`public/brand/netra-logo.svg`): NETRA in Yapari, rust, with "नेत्र" as a subtitle.
- **Michroma** (display): incident names, landing headlines. Uppercase. One weight only.
- **Chakra Petch** (UI and sentences): 400, 500, 600, 700. Row names, buttons, sentences, fix reasons.
- **IBM Plex Mono** (data and labels): IPs, users, hosts, ATT&CK and rule IDs, timestamps, bracket titles, chips, axis labels, formulas. Weight 400 and 500.
- **Doto** (dot-matrix numerals): only for numbers of 15px and above: attention scores in the queue, countdowns, gauges, the clock, HUD readouts, tier counts, rank badges. Weight 900.
  - Doto's colon and full stop are ambiguous. Always render `:` and `.` inside Doto numbers with IBM Plex Mono (a `<NumText>` component that splits on those characters). This was found in the mockup render.

Voice:
- **System voice is UPPERCASE:** bracket titles (`[ NEEDS ATTENTION ]`), labels, chips, tiers, buttons, statuses.
- **Human voice is sentence case:** signal sentences, fix reasons, explanations, empty states, row names ("HTTP flood").

Type scale (px, at 1440 wide):
| token | size / lh | face | use |
|---|---|---|---|
| num-xl | 40 / 1.05 | Doto 900 | countdown in the ring |
| num-l | 26 / 1 | Doto 900 | attention and risk readouts |
| num-m | 22 to 24 / 1 | Doto 900 | queue attention scores, clock, HUD |
| display | 21 / 1.25 | Michroma | incident name |
| hero | 40 / 1.18 | Michroma | landing headline |
| name | 14 / 1.15 | Chakra Petch 600 | row names |
| body | 13 to 15 / 1.3 to 1.5 | Chakra Petch 400 | sentences |
| btn | 12 / 1 | Chakra Petch 700, +0.07em | buttons |
| bracket | 12 / 1 | Plex Mono 500, +0.08em, uppercase | module titles |
| label | 10.5 / 1.2 | Plex Mono 400, +0.08em, uppercase, muted | labels |
| data | 11 to 12.5 / 1.3 | Plex Mono 400/500 | values, chips |

`font-variant-numeric: tabular-nums` on all numbers.

## Materials and shapes
- **Pixel field (page background)**: a full-screen canvas of 3px squares on a 9px grid, lit by three to four slow, soft colour blobs (rust bottom-left, deep maroon-violet top-right, a small ember in the middle). Squares appear by dithered probability, so the glow looks pixelated, with rare cream sparkles. The blobs drift over 40 to 60 s. Budget: 15 fps and under 2 ms per frame; render the field at low resolution and scale it up. It pauses when the tab is hidden, and it is static with reduced motion. Behind it, a CSS radial-gradient glow in the same positions gives glass something to blur.
- **Scanlines**: a fixed overlay, a 1px dark line every 3px at about 12% opacity. Never animated.
- **Glass card**: `--glass-fill`, `backdrop-filter: var(--glass-blur)`, 1px `--glass-border`, `--glass-hi`, radius 22.
- **Panel**: `--panel`, 1px `--line` border, radius 18. The title is a bracket label: `[ TITLE ]` with rust brackets and optional right-aligned meta in muted. Key panels get 12px L-shaped corner ticks in two opposite corners.
- **Rows**: radius 12, faint fill `rgba(255,255,255,.025)`. Selected: a rust gradient (`--rust` to `--rust-2`) with dark text `#1A0906`, a 1px light edge and a soft rust glow. Only one selected row exists.
- **Circles**: countdown ring (48 segments), attention gauge, confidence rings, the threat scope. Circles are for gauges only, never decoration.
- **Chips**: fully round, 22px tall, IBM Plex Mono 11px. Source tags (RULE, AI) are small rounded rectangles tinted with their colour.
- **Buttons**: radius 10, 34px tall. Approve = solid green with dark text and a soft green glow. Reject = 1px outline. Primary navigation actions (Open live dashboard) = solid rust.

## Components (`src/components/`)
- `PixelField`, `ScanlineOverlay`, `GlassCard`, `Panel` (bracket title, meta, corner ticks), `NumText` (Doto with Plex Mono punctuation)
- `QueueRow` (score, name, source tag, ATT&CK ID, 16 heat segments, time or going-cold chip), `TierHeader`
- `HeatSegments` (16 in rows; colour from the heat state; unlit `rgba(255,255,255,.07)`)
- `CountdownRing` (48 arc segments, lit share = time left, heat colour, Doto time in the centre, "STALE AT" below)
- `AttentionGauge` (rust arc ring 0 to 100 with a Doto value), `SevBars` (5 rising cream bars + "SEV 4"), `RiskReadout` (Doto value, tier chip, muted formula line)
- `SourceTag` (RULE violet, AI cyan), `Chip`, `Button`
- `EscalationList` (time, source-coloured tag, sentence, points) with `EvidenceBar` (stacked segments by source, dashed marks at 30 and 60)
- `EntityGraph` (Cytoscape), `FixCard` (glass), `ThreatScope` (SVG), `DetectionsChart` (ECharts), `SystemList`, `OSD`, `BootScreen`, `Toast`, `Glossary`

## Live dashboard layout (1440x900, no page scroll)
Matches `docs/reference/dashboard.png`:
```
+--------------------------------------------------------------------------------------+
| (glass) NETRA नेत्र  [LIVE DASHBOARD] DETECTION ENGINE REMEDIATION ENGINE              |
|         ● LIVE 14:32:07  FRESHNESS [####......] 1.8S/5S  EXPIRED 3  JUDGED NORMAL 1  SIM |
+-----------------+------------------------------------------------+-------------------+
| [NEEDS          | (glass) [INCIDENT 0142]            (countdown   | [THREAT SCOPE]    |
|  ATTENTION]     |  CREDENTIAL STUFFING,               ring 04:52) |  radar, blips     |
| ACT NOW 2       |  ACCOUNT TAKEN OVER                             |                   |
|  70 HTTP flood  |  chips | SEV bars | ATTN gauge | RISK 0.52      |                   |
| #100 Cred. stf# +------------------------------+-----------------+-------------------+
| ACT SOON 3      | [HOW IT ESCALATED]            | [WHO IS         | [DETECTIONS/MIN]  |
|  45 / 55 / 60   |  violet/cyan tagged signals   |  INVOLVED]      |  violet+cyan bars |
| WATCH 2         |  + evidence bar               |  graph          |                   |
|                 +------------------------------+-----------------+-------------------+
| JUDGED NORMAL 1 | [RECOMMENDED FIXES] (3 glass cards: rank, ring,  | [SYSTEM]          |
| EXPIRED 3       |  cyan reasons, APPROVE FIX / REJECT)             |  green status     |
+-----------------+------------------------------------------------+-------------------+
   356px              722px                                           310px
```
Reading order: left = what needs action, centre = how much time and why, right = the big picture and whether to trust it.

## Threat scope (the signature element)
An SVG radar in the style of the Earth scan. "NETRA" means eye, and this is its iris.
- Rings at 2, 5 and 10 minutes of time left (outer = 10+ min), labelled in Plex Mono. Five sectors, one per attack family: IDENTITY, WEB, FLOOD, DATA, ADMIN (mapping in DATA_CONTRACT.md). Outer tick ring, faint sector lines, a central crosshair.
- Each open incident is a blip: angle within its family's sector, **distance from centre = time left** (it drifts inward as time runs out), size = attention score (2.5 to 7px), colour = heat.
- The selected incident gets a dashed bracket square, a label ("CS/ATO 04:52") and a dashed trail showing where it came from.
- A rust sweep wedge rotates every 4 s. Legend: "CENTRE = NO TIME LEFT" and the four heat swatches.
- Clicking a blip selects that incident.

## Detections per minute
ECharts stacked bars, last 30 minutes: rule detections (violet) under AI detections (cyan). Bracket legend chips with totals ("RULES 41", "AI ENGINE 17"). Axis labels in Plex Mono, like the resource overview. When the selected incident started inside the window, a rust annotation marks that minute ("ATTACK STARTS").

## Motion
- Pixel field drifts (15 fps). Radar sweep rotates (4 s). The LIVE dot pulses at 1 Hz.
- Queue reorder: `motion` layout animation, 220ms. A new incident slides in and its row flashes once.
- Countdown and heat segments switch off one by one; counters tick without animation.
- Boot screen once per session (below). Route change: a 180ms fade with a 2px horizontal VHS offset.
- Failure: pink pulse at 1 Hz on the affected status only.
- With `prefers-reduced-motion`: no drift, sweep, pulse, flash or offsets; values just update.

## Boot screen (Netflix84 homage)
Black with the pixel field, about 1.6 s, once per session, skippable. The logo image, then IBM Plex Mono status lines that are real (feed, 26 rules, ATDE, CRIE) and a 20-segment loading bar in rust. Top-left lines: "WE WATCH THE STREAM." / "YOU MAKE THE CALL."

## Charts (`src/lib/echartsTheme.ts`)
- Transparent background; axis lines `rgba(255,120,90,.3)`; one faint baseline grid; Plex Mono 9 to 11px labels in muted.
- Series colours follow the colour roles: violet (rules), cyan (ML), green (health), heat colours (time), rust (the thing that matters). Never a default palette.
- Tooltips: glass fill, radius 10, Plex Mono.
- Reference lines (5 s target, anomaly threshold): dashed, labelled.

## Cytoscape graph (WHO IS INVOLVED)
IPs are 13px circles with a rust outline. Users are rounded rectangles; the target user is solid rust with a dark label. Hosts are hexagons with a cream outline. Edges: 1px `rgba(255,120,90,.45)`; the edge to the host is dashed cream. Labels Plex Mono 9.5px. Legend under the graph. Capped at 25 nodes.

## Copy
- System voice: NEEDS ATTENTION, ACT NOW, ACT SOON, WATCH, JUDGED NORMAL, EXPIRED, TIME LEFT, ATTENTION, SEVERITY, RISK, DETECTED BY RULES, WHY THE AI PICKED IT, APPROVE FIX, REJECT, SIMULATED FEED, PENDING, CENTRE = NO TIME LEFT.
- Human voice: signal sentences, fix reasons, "Flash crowd, 14:12", "No incident raised. Nothing for an analyst to do.", "Live feed stopped 12 s ago. Showing the last known state."
- Toast: "Fix approved. Saved as training data for both engines."
- No exclamation marks, no filler, no em dashes, no arrows on buttons.

## Anti-patterns
Generic tells:
- blurred glass behind dense data
- rainbow or default chart palettes
- identical cards everywhere
- soft grey drop shadows
- gradient blobs you can see move
- invented metrics

Retro clichés:
- synthwave magenta and cyan used as decoration (our cyan means "ML output", nothing else)
- neon grids with a sun
- Orbitron
- Matrix rain
- glitch on everything
- CRT curvature or flicker

Colour discipline:
- any colour used outside its row in the colour roles table
