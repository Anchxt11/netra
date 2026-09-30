// Step 2 (DETECT): the view has dived into "YOUR NETWORK". An isometric wireframe of the four
// hosts on a grid, data streaming in. One stream turns bright yellow (fresh data), a bracket locks
// onto it, then a rule tag (violet) and an AI tag (cyan) confirm what each engine saw.
// Every reveal is driven by scroll, through `t` (0 = start of step 2's transition, 1 = step 2 settled).
import { motion, useTransform, type MotionValue } from "motion/react";
import { SourceTag } from "../components/SourceTag";
import styles from "./NetworkIso.module.css";

const CX = 380;
const CY = 400;
const U = 44; // one grid unit
const COS30 = Math.cos(Math.PI / 6);

/** Grid (i, j, height) to screen. */
const iso = (i: number, j: number, z = 0) => ({ x: CX + (i - j) * U * COS30, y: CY + (i + j) * U * 0.5 - z });
const pts = (list: { x: number; y: number }[]) => list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

interface Host {
  name: string;
  i: number;
  j: number;
  h: number; // block height in px
}

const HOSTS: Host[] = [
  { name: "web-02", i: -2, j: -2, h: 46 },
  { name: "web-01", i: -2, j: 2, h: 46 },
  { name: "db-01", i: 2, j: -2, h: 64 },
  { name: "auth-01", i: 2, j: 2, h: 56 },
];

const HALF = 0.7; // block half-width in grid units

function Block({ host }: { host: Host }) {
  const { i, j, h } = host;
  const a = iso(i - HALF, j - HALF);
  const b = iso(i + HALF, j - HALF);
  const c = iso(i + HALF, j + HALF);
  const d = iso(i - HALF, j + HALF);
  const up = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - h });
  const label = up(a);
  return (
    <g>
      <polygon points={pts([d, c, up(c), up(d)])} className={styles.faceLeft} />
      <polygon points={pts([c, b, up(b), up(c)])} className={styles.faceRight} />
      <polygon points={pts([up(a), up(b), up(c), up(d)])} className={styles.faceTop} />
      <text x={label.x} y={label.y - 12} className={styles.hostLabel}>
        {host.name}
      </text>
    </g>
  );
}

// Streams arrive along the grid lines, from beyond the floor's edge into a host.
const STREAMS: { id: string; path: [number, number][] }[] = [
  { id: "s-web01", path: [[-6.5, 2], [-2.7, 2]] },
  { id: "s-web02", path: [[-2, -6.5], [-2, -2.7]] },
  { id: "s-db01", path: [[6.5, -2], [2.7, -2]] },
  { id: "s-side", path: [[-1, 6.5], [-1, 2], [1.3, 2]] },
];
// The stream that turns yellow: into auth-01 from the front edge.
const HOT: [number, number][] = [[2, 6.8], [2, 2.7]];
const EVENT_AT = iso(2, 4.9); // where the bracket locks on

const toPts = (path: [number, number][]) => pts(path.map(([i, j]) => iso(i, j)));

const FLOOR = Array.from({ length: 9 }, (_, k) => k - 4);

interface Props {
  t: MotionValue<number>;
  /** Reduced motion: fades only, no scaling. */
  still?: boolean;
}

export function NetworkIso({ t, still }: Props) {
  const opacity = useTransform(t, [0.4, 0.62], [0, 1]);
  const scale = useTransform(t, [0.4, 0.7], still ? [1, 1] : [0.86, 1]);
  const hot = useTransform(t, [0.55, 0.68], [0, 1]);
  const bracketOpacity = useTransform(t, [0.66, 0.76], [0, 1]);
  const bracketScale = useTransform(t, [0.66, 0.78], still ? [1, 1] : [1.8, 1]);
  const ruleTag = useTransform(t, [0.74, 0.82], [0, 1]);
  const aiTag = useTransform(t, [0.84, 0.92], [0, 1]);

  const left = (x: number) => `${(x / 760) * 100}%`;
  const top = (y: number) => `${(y / 760) * 100}%`;

  return (
    <motion.div className={styles.network} style={{ opacity, scale }} aria-hidden="true">
      <svg viewBox="0 0 760 760" className={styles.svg}>
        {/* floor grid */}
        <g className={styles.floor}>
          {FLOOR.map((k) => (
            <g key={k}>
              <line x1={iso(k, -4).x} y1={iso(k, -4).y} x2={iso(k, 4).x} y2={iso(k, 4).y} />
              <line x1={iso(-4, k).x} y1={iso(-4, k).y} x2={iso(4, k).x} y2={iso(4, k).y} />
            </g>
          ))}
        </g>

        {/* incoming streams: dashes march toward the hosts */}
        {STREAMS.map((s) => (
          <polyline key={s.id} points={toPts(s.path)} className={styles.stream} />
        ))}
        <polyline points={toPts(HOT)} className={styles.stream} />
        <motion.polyline points={toPts(HOT)} className={styles.hotStream} style={{ opacity: hot }} />

        {HOSTS.map((h) => (
          <Block key={h.name} host={h} />
        ))}

        {/* the event on the hot stream, and the bracket that locks onto it */}
        <motion.g style={{ opacity: hot }}>
          <rect x={EVENT_AT.x - 7} y={EVENT_AT.y - 7} width="14" height="14" className={styles.eventGlow} />
          <rect x={EVENT_AT.x - 3} y={EVENT_AT.y - 3} width="6" height="6" className={styles.event} />
        </motion.g>
        <motion.rect
          x={EVENT_AT.x - 16}
          y={EVENT_AT.y - 16}
          width="32"
          height="32"
          className={styles.bracket}
          style={{ opacity: bracketOpacity, scale: bracketScale }}
        />
      </svg>

      {/* what each engine saw */}
      <div className={styles.tags} style={{ left: left(EVENT_AT.x + 26), top: top(EVENT_AT.y - 16) }}>
        <motion.div style={{ opacity: ruleTag }}>
          <SourceTag source="rule" label="RULE CS-1" className={styles.tag} />
        </motion.div>
        <motion.div style={{ opacity: aiTag }}>
          <SourceTag source="ai" label="AI ENGINE 0.81" className={styles.tag} />
        </motion.div>
      </div>
    </motion.div>
  );
}
