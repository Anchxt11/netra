# NETRA frontend

NETRA is a real-time security risk dashboard for Microsoft Innovate 2026, Problem 34: "Decisions While the Data's Still Warm". It finds the threats that matter in live security events, ranks them by danger and by how much time is left to act on them, and recommends fixes that a human analyst approves. "Netra" means "eye".

I am the team lead and a trained designer, but new to web development. After each change, tell me in one or two plain sentences what you did and what to look at in the browser. Define any jargon the first time you use it.

## Read these before working
- `docs/DESIGN.md`: the design system. Read it before any UI work. It is the source of truth for every visual decision.
- `docs/PAGES.md`: what each page shows, in what priority, and why.
- `docs/DATA_CONTRACT.md`: data shapes, attack scenarios, signal sentences, the mock engine and the demo scenarios. Items marked (confirm) are still open.
- `docs/reference/dashboard.png` and `docs/reference/landing-step1.png`: the approved visual targets (1440x900). Their HTML sources (`dashboard.html`, `landing-step1.html`) hold exact CSS values, the pixel-field code, the radar maths and the globe code. Copy values from them, but build proper components; they are references, not production code. Where they disagree with the docs, the docs win.
- `docs/backend/`: the backend team's own files (raw event schema, detection rules PDF, sample events). If they disagree with DATA_CONTRACT.md, the backend files win: tell me instead of guessing.

Read only the file(s) the current task needs.

## Stack (fixed: do not add to it without asking me)
- Vite, React 19, TypeScript (strict).
- CSS Modules plus one global token file: `src/styles/tokens.css`. No Tailwind. No component libraries (no shadcn, MUI, Chakra, Ant, Bootstrap, DaisyUI).
- `react-router-dom` for routes, `zustand` for state
- `echarts` + `echarts-for-react` for charts, always with our theme from `src/lib/echartsTheme.ts`. Never ship ECharts' default colours, fonts or tooltips.
- `cytoscape` + `react-cytoscapejs` for the incident entity graph
- `motion` (import from `"motion/react"`): queue reorder, a new incident's arrival, and `useScroll` for the landing steps
- `@phosphor-icons/react`, weight "regular" or "bold" only, used sparingly
- `d3-geo`, `topojson-client`, `world-atlas` (and optionally `lenis`): landing page globe only, lazy-loaded so the dashboard never downloads them. No three.js, no Spline.
- Fonts: `@fontsource/michroma` (400), `@fontsource/chakra-petch` (400, 500, 600, 700), `@fontsource/ibm-plex-mono` (400, 500), `@fontsource/doto` (900)

## Commands
- `npm run dev` starts the app at http://localhost:5173
- `npm run build` type-checks and builds. Run it after every feature and fix every error before saying you are done.
- `npm run preview` serves the production build. We demo from this, not from dev.

## Environment
- `VITE_DATA_SOURCE=mock` (default) or `ws`
- `VITE_WS_URL=ws://localhost:8000/ws`
The UI must never know which source is active except through the "simulated feed" chip.

## Folder structure
```
src/
  app/          router, AppShell (top bar + page frame)
  styles/       tokens.css, global.css, fonts.ts
  data/         types.ts, source.ts (DataSource interface), mockEngine.ts, wsSource.ts, scenarios/, fixtures/
  store/        useNetra.ts (zustand)
  lib/          heat.ts, rank.ts, family.ts, time.ts, format.ts, echartsTheme.ts
  landing/      Globe (canvas), NetworkIso (SVG), StepStage, steps.ts
  components/   PixelField, ScanlineOverlay, GlassCard, Panel, NumText, QueueRow, TierHeader, HeatSegments, CountdownRing,
                AttentionGauge, SevBars, RiskReadout, SourceTag, Chip, Button, EscalationList, EvidenceBar, FixCard,
                ThreatScope, DetectionsChart, SystemList, OSD, BootScreen, Toast, Glossary
  features/     topbar/, queue/, detail/, fixes/, health/
  pages/        Landing, LiveDashboard, DetectionEngine, RemediationEngine
public/brand/   netra-logo.svg, hero-fallback.png
```

## Design rules that must never break (full detail in docs/DESIGN.md)
The look is "phosphor glass": a retro security console in rust and black, with a slow pixel-dot field glowing behind glass, bracket-framed data panels, circular gauges and a radar scope.
1. Glass is for focus and decisions (top bar, incident focus card, fix cards, landing caption cards). Opaque panels are for data (queue, escalation, graph, scope, charts, system). Never put glass behind dense data.
2. Every colour has one job (the colour roles table in DESIGN.md). Rust = brand, selection, primary action, ACT NOW. Heat colours = time left. Violet = a rule detected it. Cyan = an ML model produced it. Green = healthy, live, judged normal, approve. Pink = our own pipeline failing. Never use a colour outside its role.
3. Severity is never colour: SevBars plus "SEV 4".
4. Ranking follows `src/lib/rank.ts` exactly (tiers ACT NOW, ACT SOON, WATCH). Never sort by another rule in a component.
5. Type roles: Michroma = incident names and headlines; Chakra Petch = UI and sentences; IBM Plex Mono = data, labels, bracket titles, chips; Doto = numerals of 15px and above only. Render `:` and `.` inside Doto numbers in IBM Plex Mono (the `NumText` component).
6. System voice is UPPERCASE (labels, chips, tiers, buttons, bracket titles). Human voice is sentence case (signal sentences, reasons, explanations).
7. Radius encodes material: glass 22, panel 18, row 12, button 10, chip fully round. Circles only for gauges.
8. Exactly one selected row (the rust gradient block). One primary action colour per card.
9. Motion only where something changed, plus three ambient loops: pixel-field drift (15 fps, under 2 ms per frame), the radar sweep and the LIVE pulse. Everything respects `prefers-reduced-motion`.
10. No emoji, no arrows on buttons, no em dashes in UI copy. Buttons say what happens: "APPROVE FIX", "REJECT".
11. Honesty: the SIMULATED FEED chip shows on mock data; boot statuses are real; model metrics come only from `src/data/fixtures/`; missing values show "PENDING". Never invent a metric. The landing globe's locations are illustrative; never name real places as attack sources.

## How to work with me
- For anything bigger than a small fix, first give me a plan in 3 to 6 bullets.
- One feature at a time, small changes. After each: `npm run build`, fix errors, then tell me what to check in the browser.
- Do not install packages or edit `tokens.css` without asking.
- If the same fix fails twice, stop and explain the problem instead of trying random changes.
- When a visual choice is not covered by docs/DESIGN.md, ask me. I am the designer.
- After each working feature, commit: `git add -A` then `git commit -m "feat: <what changed>"`. Never force-push, never rewrite history, never delete files outside `src/` without asking.
- Accessibility floor: visible focus (2px rust outline, 2px offset), everything reachable by keyboard, text contrast at least 4.5:1 below 18px.

## Target screens
The demo runs on a laptop and a projector. Design for 1440x900. It must work at 1280x720 with no horizontal scrolling. Mobile is out of scope for now.
