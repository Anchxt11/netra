// THREAT SCOPE: NETRA's "iris". Every open incident is a blip: angle = its attack family,
// distance from centre = time left (it drifts inward), size = attention, colour = heat.
// Maths from docs/reference/dashboard.html; families from src/lib/family.ts.
import type { KeyboardEvent } from "react";
import type { AttackType, Incident } from "../data/types";
import { FAMILIES, FAMILY_CENTRE, blipAngle, blipDistance, blipSize, sectorEdges } from "../lib/family";
import { heatColor } from "../lib/heat";
import type { Ranked } from "../lib/rank";
import { formatCountdown } from "../lib/time";
import styles from "./ThreatScope.module.css";

const W = 310;
const H = 268;
const CX = 155;
const CY = 130;
const R = 100; // 10 minutes of time left
const RINGS = [
  { min: 10, r: R, solid: true },
  { min: 5, r: R * 0.5, solid: false },
  { min: 2, r: R * 0.2, solid: false },
];

// Short codes match the rule prefixes (CS-1, HF-2 ...), so the label reads like the escalation list.
const SHORT: Record<AttackType, string> = {
  brute_force: "BF",
  credential_stuffing: "CS",
  account_takeover: "ATO",
  web_scan: "WS",
  data_exfiltration: "EX",
  admin_abuse: "AA",
  http_flood: "HF",
};

const polar = (r: number, deg: number) => ({
  x: CX + r * Math.cos((deg * Math.PI) / 180),
  y: CY + r * Math.sin((deg * Math.PI) / 180),
});

const TICKS = Array.from({ length: 72 }, (_, i) => {
  const deg = i * 5;
  const long = deg % 30 === 0;
  const a = polar(R + 2, deg);
  const b = polar(R + (long ? 11 : 6), deg);
  return { a, b, long };
});

const EDGES = sectorEdges().map((deg) => polar(R, deg));

// A 30° wedge trailing the sweep line (the line sits at 0°, the wedge behind it).
const WEDGE = (() => {
  const a = polar(R, -30);
  const b = polar(R, 0);
  return `M${CX},${CY} L${a.x.toFixed(1)},${a.y.toFixed(1)} A${R},${R} 0 0 1 ${b.x.toFixed(1)},${b.y.toFixed(1)} Z`;
})();

interface Props {
  incidents: Ranked<Incident>[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Small, inside a closed tile: no labels or legend, and the blips are not separate focus stops. */
  compact?: boolean;
}

export function ThreatScope({ incidents, selectedId, onSelect, compact = false }: Props) {
  const blips = incidents.map((i) => {
    const angle = blipAngle(i.id, i.attackType);
    const minutesLeft = i.rank.timeLeftMs / 60_000;
    const windowMin = (Date.parse(i.staleBy) - Date.parse(i.createdAt)) / 60_000;
    return {
      inc: i,
      angle,
      pos: polar(blipDistance(minutesLeft, R), angle),
      start: polar(blipDistance(windowMin, R), angle), // where it first appeared
      size: blipSize(i.attentionScore),
      color: heatColor(i.rank.remaining),
    };
  });
  // Draw the selected blip last so it sits on top.
  blips.sort((a, b) => Number(a.inc.id === selectedId) - Number(b.inc.id === selectedId));
  const selected = blips.find((b) => b.inc.id === selectedId);

  const onKey = (e: KeyboardEvent<SVGGElement>, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  };

  return (
    <div className={styles.scope}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="group" aria-label="Threat scope: open incidents by attack family and time left">
        <defs>
          <radialGradient id="scope-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" style={{ stopColor: "var(--rust)", stopOpacity: 0.14 }} />
            <stop offset="1" style={{ stopColor: "var(--rust)", stopOpacity: 0 }} />
          </radialGradient>
        </defs>

        <circle cx={CX} cy={CY} r={R} fill="url(#scope-glow)" />

        {/* The sweep: one rotation every 4 s. Still with reduced motion. */}
        <g className={styles.sweep} style={{ transformOrigin: `${CX}px ${CY}px` }} aria-hidden="true">
          <path d={WEDGE} className={styles.wedge} />
          <line x1={CX} y1={CY} x2={CX + R} y2={CY} className={styles.sweepLine} />
        </g>

        {/* Rings, ticks, sector edges, crosshair */}
        <g aria-hidden="true">
          {RINGS.map((ring) => (
            <g key={ring.min}>
              <circle cx={CX} cy={CY} r={ring.r} className={ring.solid ? styles.ring : styles.ringDashed} />
              {!compact && (
                <text x={CX + 4} y={CY - ring.r + 11} className={styles.ringLabel}>
                  {ring.min}M
                </text>
              )}
            </g>
          ))}
          {TICKS.map((t, i) => (
            <line key={i} x1={t.a.x} y1={t.a.y} x2={t.b.x} y2={t.b.y} className={t.long ? styles.tickLong : styles.tick} />
          ))}
          {EDGES.map((p, i) => (
            <line key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} className={styles.edge} />
          ))}
          <line x1={CX - 6} y1={CY} x2={CX + 6} y2={CY} className={styles.cross} />
          <line x1={CX} y1={CY - 6} x2={CX} y2={CY + 6} className={styles.cross} />
          {!compact && FAMILIES.map((f) => {
            const p = polar(R + 19, FAMILY_CENTRE[f]);
            return (
              <text key={f} x={p.x} y={p.y + 3} className={styles.family}>
                {f}
              </text>
            );
          })}
        </g>

        {/* Where the selected incident came from: straight in along its family's angle. */}
        {selected && (
          <line
            x1={selected.start.x}
            y1={selected.start.y}
            x2={selected.pos.x}
            y2={selected.pos.y}
            className={styles.trail}
            aria-hidden="true"
          />
        )}

        {blips.map((b) => {
          const isSel = b.inc.id === selectedId;
          return (
            <g
              key={b.inc.id}
              className={styles.blip}
              role={compact ? undefined : "button"}
              tabIndex={compact ? undefined : 0}
              aria-pressed={compact ? undefined : isSel}
              aria-label={compact ? undefined : `${b.inc.name}, ${formatCountdown(b.inc.rank.timeLeftMs)} left, attention ${b.inc.attentionScore}`}
              onClick={compact ? undefined : () => onSelect(b.inc.id)}
              onKeyDown={compact ? undefined : (e) => onKey(e, b.inc.id)}
            >
              <circle cx={b.pos.x} cy={b.pos.y} r={b.size + 7} className={styles.hit} />
              <circle cx={b.pos.x} cy={b.pos.y} r={b.size + 4} fill={b.color} opacity={0.18} />
              <circle cx={b.pos.x} cy={b.pos.y} r={b.size} fill={b.color} />
              <circle cx={b.pos.x} cy={b.pos.y} r={b.size + 5} className={styles.focusRing} />
            </g>
          );
        })}

        {selected && !compact && <SelectedMark x={selected.pos.x} y={selected.pos.y} text={`${SHORT[selected.inc.attackType]} ${formatCountdown(selected.inc.rank.timeLeftMs)}`} />}
      </svg>

      {!compact && (
      <div className={styles.legend} aria-hidden="true">
        <span>Centre = no time left</span>
        <span className={styles.heatKey}>
          warm
          <i style={{ background: "var(--heat-1)" }} />
          <i style={{ background: "var(--heat-2)" }} />
          <i style={{ background: "var(--heat-3)" }} />
          <i style={{ background: "var(--heat-4)" }} />
          cold
        </span>
      </div>
      )}
    </div>
  );
}

/** Dashed corner bracket around the selected blip, with its short name and time left. */
function SelectedMark({ x, y, text }: { x: number; y: number; text: string }) {
  const s = 24;
  const labelLeft = x > W - 90; // keep the label inside the scope
  return (
    <g aria-hidden="true" pointerEvents="none">
      <rect x={x - s / 2} y={y - s / 2} width={s} height={s} className={styles.bracket} />
      <text x={labelLeft ? x - s / 2 - 3 : x + s / 2 + 3} y={y - s / 2} className={styles.label} textAnchor={labelLeft ? "end" : "start"}>
        {text}
      </text>
    </g>
  );
}
