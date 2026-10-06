# NETRA design system v2: "warm data"

Adopted 2026-10-07. Replaces the v1 "phosphor glass" system. Mockups: the Design canvas "NETRA brand and UI direction" (Dashboard B and the landing page are the chosen boards). Tokens: `src/styles/tokens.css`.

## The idea
Data is warm when it arrives and cools as it ages. NETRA shows that cooling and asks a person to act before it is gone. Every screen is quiet by default (big numbers, few lines, lots of dark space) and comes alive on contact: tiles wake up, open and animate only when hovered, focused or clicked.

## Four rules
1. **Quiet by default.** Nothing glows unless it matters. No scanlines, corner ticks or film grain.
2. **Alive on contact.** Tiles are still until hover, keyboard focus or click; then they lift, warm up with ember light from their corner, animate their drawing and open.
3. **One accent.** Rust means act. Ember to ash means time running out. Everything else is graphite and grey.
4. **Honest numbers.** Real values or a clear placeholder (PENDING, Example data). Never a decorative digit.

## Colour roles (never mix them)
| colour | token | job |
|---|---|---|
| ink, graphite, graphite 2 | `--bg` `--panel` `--panel-2` | page, cards, hover and selection |
| bone, stone, ash, faint | `--text-hi` `--text` `--muted` `--faint` | numbers and titles, sentences, labels, trailing digits |
| rust (and ember) | `--rust` `--ember` | act: ACT NOW, the selected item, the primary button (FIX), brand |
| ember to ash scale | `--heat-1..4` `--stale` | time left only: just arrived (ember) to going cold (ash) |
| neutral | `--rule` | a rule found it |
| lilac | `--ai` | the AI engine found it, or produced it (confidence, reasons) |
| blue | `--ok` | healthy, live, judged normal, approve |
| red | `--fail` | our own pipeline is failing. Always with words. |

Going cold is shown by the ash colour plus the ACT NOW tier and a solid rust time chip, never by colour alone.

## Type
- **Geist** (`--font-ui`, `--font-num`) for everything read. Big numbers in weight 200 with tight tracking; their last digits are `--faint` so the eye reads the size first (`12,7`<faint>`43`</faint>).
- **Geist Mono** (`--font-data`) for addresses, ids, times and technique ids.
- **Michroma** (`--font-display`) for the NETRA wordmark only.
- Sentence case for titles and labels. Capitals only inside small status pills (ACT NOW). Buttons say what happens: "Approve fix", "Reject", "Fix".

## Shape and light
- Cards: graphite, 24 to 28 px radius, a hairline border and a faint top highlight. Rows 14, buttons 12, pills round. Circles only for gauges and the radar.
- Hover: the card lifts 4 px and ember light spreads from its top-left corner (`--ember-light`).
- Glass (blur, `--glass-*`) only for the nav pill, open tiles, the fixes overlay and toasts.
- The incident card keeps one texture: a faint grid of ember dots fading from its top-right corner (the v1 pixel field, reduced to a whisper).

## Charts
- Step lines over a faint live trace: one step per bucket, labelled with its value and change; a rust step means flagged traffic rose. ECharts only through `src/lib/echartsTheme.ts`.
- Segmented rings and gauges: rounded segments, lit ones cool from ember to ash, unlit ones `--unlit`.
- Escalation: attention climbs in steps, one step per signal, labelled with its points and a short reason; the AI step is lilac.

## Motion (only to explain a change or answer a touch)
- Dashboard: the live feed (new rows slide in, bars advance) and the radar sweep are the ambient loops. Tiles open on hover or focus. Numbers roll when the value changes. New incidents slide into the queue with one rust flash. FIX fans the three fixes on hover and opens them on click.
- Landing: the hero line ("cooling words": each novelty arrives ember-hot and cools to grey), one slow ember ribbon, the dotted globe, and ONE particle transition: the globe's dots break apart and re-form as the dashboard as you scroll (`PixelMorph`). The five steps are hover-alive cards, not a pinned scroll.
- `prefers-reduced-motion`: crossfades only; nothing loops.

## Kept from v1
The eye mark and wordmark, the centred glass nav pill (DASHBOARD, ENGINES, HOME; no call to action), the live heartbeat trace instead of a pulsing dot, the segmented countdown ring, the evidence bar, the radar threat scope, the dotted globe and the pixel break-apart.

## Accessibility
Focus ring 2 px rust with 2 px offset. Everything that opens on hover also opens on keyboard focus and on click, and closes with Esc. Text contrast at least 4.5:1 below 18 px. Works at 1440x900 and 1280x720 without sideways scrolling.

## Anti-patterns
Uppercase paragraphs; more than one accent on a card; glass behind dense tables; colour as the only signal; decorative numbers; loops that explain nothing.
