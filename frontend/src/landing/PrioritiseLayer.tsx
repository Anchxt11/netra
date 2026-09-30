// Step 4 (PRIORITISE): the incident gets a deadline. The dashboard's countdown ring drains as you
// scroll, its tier lights up on the WATCH / ACT SOON / ACT NOW scale, and it climbs the queue
// past incidents with more time left. Ranking comes from src/lib/rank.ts, exactly as on the dashboard.
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { motion, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import { CountdownRing } from "../components/CountdownRing";
import { rankIncidents, type Tier } from "../lib/rank";
import { heatColor } from "../lib/heat";
import { formatCountdown } from "../lib/time";
import { QUEUE, RING, TIERS, TIER_X, TIER_Y } from "./prioritiseGeometry";
import styles from "./PrioritiseLayer.module.css";

const WINDOW_MS = 10 * 60_000;
const OURS = "cs";

// Illustrative neighbours in the queue, with their own (fixed) time left.
const OTHERS = [
  { id: "hf", name: "HTTP flood", severity: 4, attentionScore: 70, remaining: 0.2, windowMs: 3 * 60_000 },
  { id: "bf", name: "Brute force", severity: 3, attentionScore: 70, remaining: 0.3, windowMs: WINDOW_MS },
  { id: "ws", name: "Web scan", severity: 2, attentionScore: 40, remaining: 0.5, windowMs: 15 * 60_000 },
];

const pct = (v: number) => `${(v / 760) * 100}%`;

export function PrioritiseLayer({ t, still }: { t: MotionValue<number>; still?: boolean }) {
  // Arrives as the pixels land (with reduced motion, no pixels: it simply fades in sooner),
  // and hands over to step 5's pixels just past t = 3.
  const layer = useTransform(t, still ? [2.1, 2.3, 3.04, 3.1] : [2.48, 2.6, 3.04, 3.1], [0, 1, 1, 0]);
  // The clock runs down as you scroll: 98% of the window left, down to 6%.
  const drain = useTransform(t, [2.56, 2.94], [0.98, 0.06]);
  const [remaining, setRemaining] = useState(0.98);
  useMotionValueEvent(drain, "change", (v) => setRemaining(Math.round(v * 200) / 200));
  const nowRef = useRef(Date.now());
  const staleBy = useMemo(() => new Date(nowRef.current + 0.98 * WINDOW_MS).toISOString(), []);

  // Rank ours against the neighbours with the dashboard's own rule.
  const ranked = useMemo(() => {
    const now = nowRef.current;
    const at = (rem: number, windowMs: number) => {
      const created = now - (1 - rem) * windowMs;
      return { createdAt: new Date(created).toISOString(), staleBy: new Date(created + windowMs).toISOString() };
    };
    return rankIncidents(
      [
        { id: OURS, name: "Credential stuffing", severity: 4, attentionScore: 80, ...at(remaining, WINDOW_MS) },
        ...OTHERS.map((o) => ({ ...o, ...at(o.remaining, o.windowMs) })),
      ],
      now,
    );
  }, [remaining]);
  const ours = ranked.find((r) => r.id === OURS)!;
  const tier: Tier = ours.rank.tier;
  const ringStyle = { "--ring-size": `calc(var(--stage-size) * ${RING.size / 760})` } as CSSProperties;

  return (
    <motion.div className={styles.layer} style={{ opacity: layer }} aria-hidden="true">
      {/* the dashboard's countdown ring, draining */}
      <div className={styles.ring} style={{ ...ringStyle, left: pct(RING.cx - RING.size / 2), top: pct(RING.cy - RING.size / 2) }}>
        <CountdownRing remaining={remaining} timeLeftMs={remaining * WINDOW_MS} staleBy={staleBy} />
      </div>

      <svg viewBox="0 0 760 760" className={styles.svg}>
        {/* the tier scale: the incident's tier lights up */}
        {TIERS.map((s, i) => {
          const on = s.tier === tier;
          const cls = on ? (s.tier === "ACT NOW" ? styles.tierNow : styles.tierOn) : styles.tierOff;
          return (
            <g key={s.tier}>
              <rect x={TIER_X[i]} y={TIER_Y} width={s.w} height="22" rx="11" className={cls} />
              <text x={TIER_X[i] + s.w / 2} y={TIER_Y + 15} className={`${styles.tierText} ${on && s.tier === "ACT NOW" ? styles.tierTextNow : on ? styles.tierTextOn : ""}`}>
                {s.tier}
              </text>
            </g>
          );
        })}
        <text x={RING.cx} y={TIER_Y + 52} className={styles.note}>
          Time left before this data goes stale
        </text>

        {/* the mini queue */}
        <text x={QUEUE.x} y={QUEUE.y - 18} className={styles.queueTitle}>
          NEEDS ATTENTION
        </text>
        <line x1={QUEUE.x} y1={QUEUE.y - 10} x2={QUEUE.x + QUEUE.w} y2={QUEUE.y - 10} className={styles.rule} />
        {ranked.map((r, index) => {
          const mine = r.id === OURS;
          const rem = mine ? remaining : (OTHERS.find((o) => o.id === r.id)?.remaining ?? 0);
          const windowMs = mine ? WINDOW_MS : (OTHERS.find((o) => o.id === r.id)?.windowMs ?? WINDOW_MS);
          return (
            <motion.g
              key={r.id}
              initial={false}
              animate={{ y: QUEUE.y + index * QUEUE.step }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
            >
              <rect x={QUEUE.x} y={0} width={QUEUE.w} height={QUEUE.rowH} rx="8" className={mine ? styles.rowMine : styles.row} />
              <text x={QUEUE.x + 14} y={28} className={mine ? styles.rowNameMine : styles.rowName}>
                {r.name}
              </text>
              <text x={QUEUE.x + 170} y={27} className={mine ? styles.rowTierMine : styles.rowTier}>
                {r.rank.tier}
              </text>
              {/* time left, with a heat-coloured bar */}
              <rect x={QUEUE.x + QUEUE.w - 78} y={30} width={64} height={3} rx="1.5" className={mine ? styles.barTrackMine : styles.barTrack} />
              <rect
                x={QUEUE.x + QUEUE.w - 78}
                y={30}
                width={64 * rem}
                height={3}
                rx="1.5"
                style={{ fill: mine ? "var(--on-rust)" : heatColor(rem) }}
              />
              <text x={QUEUE.x + QUEUE.w - 14} y={22} className={mine ? styles.rowTimeMine : styles.rowTime}>
                {formatCountdown(rem * windowMs)}
              </text>
            </motion.g>
          );
        })}
        <text x={QUEUE.x} y={QUEUE.y + QUEUE.rows * QUEUE.step + 16} className={`${styles.note} ${styles.left}`}>
          Less time left, higher in the queue
        </text>
      </svg>
    </motion.div>
  );
}
