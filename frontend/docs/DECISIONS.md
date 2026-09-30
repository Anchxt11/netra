# NETRA frontend: decisions log

Where the built frontend deliberately differs from `DESIGN.md` and `PAGES.md`, and why. Where this
file and those two disagree, this file describes what is built. Open items at the end.

## Design (dashboard)
- **Quieter "console" theme on the dashboard and engine pages.** `src/styles/console.css` re-tunes the tokens (calmer colours, thinner glass, glows off, tighter corners) inside `[data-surface="console"]`. The landing page keeps the vivid originals from `tokens.css`, which is unchanged. Reason: the dashboard was trying too hard; it should read industrial.
- **No Doto.** All numerals use IBM Plex Mono through `NumText` (`--font-num`), so the face can be swapped in one place.
- **Header:** a compact, pinned, fully rounded glass pill that wraps only the logo (the eye mark, `public/brand/netra-mark.png`) and three links: DASHBOARD, ENGINES, HOME. No call to action in the header. Status readouts sit either side of the pill: live trace, clock and freshness on the left; EXPIRED, JUDGED NORMAL and SIMULATED FEED on the right.
- **Live indicator:** a small trace of events per second over the last 30 s instead of a pulsing green dot. It moves only because data arrives, and flatlines in pink when the feed fails.
- **Fix cards** show the top 2 reasons (PAGES allows 2 or 3) so the buttons always fit.
- **WHO IS INVOLVED** groups extra targeted accounts into one "+N ACCOUNTS" node so campaigns stay readable.
- **Scrolling:** the header is pinned. Below 900px tall the dashboard scrolls vertically, never sideways; below 1400px wide the side columns narrow.

## Landing page
- **Minimal copy:** NETRA (the wordmark) large, "Security decisions while the data is still warm.", one button. No paragraph, no second button, no step bracket label.
- **Every step explains itself:** a step card (title, one sentence, a two or three item colour key) and a few short plain-language labels on the drawing.
- **One transition, everywhere:** the pixel break-apart. Each drawing turns into dots that burst out and re-form as the next drawing (`src/landing/PixelMorph.tsx`). No zooms.
- **Scroll is spring-smoothed** (`useSpring`), 120vh per step, with a rest at each step.
- **HUD readouts:** "EVENTS TODAY" replaces the reference's "SOURCES SEEN 1,284", which had no data behind it.
- **Step 4 tiers:** the incident moves ACT SOON to ACT NOW. With `rank.ts`, time alone cannot lift an incident out of WATCH (weak evidence never jumps the queue), so WATCH stays on the scale as a reference.
- **Globe:** sways slowly instead of spinning, so YOUR NETWORK never hides behind it. Canvas pixel ratio capped at 2 (sharper on high-resolution screens).

## Data and honesty
- **Mock CRIE:** the mock engine plays CRIE too, so background incidents get example fixes (about 1 in 7, and any with weak evidence, get the MITRE fallback instead). Both models report version "example". Decisions start at 0 / 0.
- **Demo scenario timings** follow DATA_CONTRACT.md. The scripted incident keeps credential stuffing's 10-minute window and T1110.004 after the takeover; its risk reads 0.51 (the formula applied exactly), not 0.52.
- **D3FEND:** actions without a mapped technique show "D3FEND: PENDING".
- **Engine pages** show an honest standby (stages to come, model card read from the fixture, PENDING for anything missing) until the ML team's export arrives with `"source": "model-export"`.

## Open items
- Prompts J and K: build the engine walkthroughs when the ML team's `atde_samples.json` and `crie_samples.json` arrive.
- Backend: WebSocket URL and message types, points for every rule, stale-by windows, where ground-truth labels live (see DATA_CONTRACT.md "Still open").
- Reduced motion on the landing: transforms and the pixel break-apart are off and steps crossfade; PAGES.md's "five stacked still frames" layout is not built.
- `public/brand/hero-fallback.png` is not needed (the globe is plain canvas, no WebGL) and was not created.
- Yapari licence for the wordmark (see START_HERE.md).
