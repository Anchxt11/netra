// Step 3 (CORRELATE): six attacking addresses appear around auth-01, each drawing a line to the one
// account they all target. Their warning signs pop up, then glide together into ONE INCIDENT.
// Drawn like the dashboard's WHO IS INVOLVED graph (addresses = rust rings, target = solid rust).
// Scroll-driven through `t` (1 = step 2 settled, 2 = step 3 settled). All SVG, so it stays crisp.
import { motion, useTransform, type MotionValue } from "motion/react";
import { iso, type Pt } from "./networkGeometry";
import styles from "./CorrelateLayer.module.css";

/** The account sits on top of auth-01, like a token on the server it lives on. */
const ACCOUNT = iso(2, 2, 56);
const ACCOUNT_NAME = "maria.silva";

// Six addresses on a ring around auth-01 (grid units), with their last octets as labels.
const RING = 2.8;
const ADDRESSES = [
  { deg: 75, label: ".24" },
  { deg: 135, label: ".31" },
  { deg: 195, label: ".57" },
  { deg: -105, label: ".88" },
  { deg: -45, label: ".102" },
  { deg: 15, label: ".140" },
].map((a) => {
  const r = (a.deg * Math.PI) / 180;
  return { ...a, at: iso(2 + RING * Math.cos(r), 2 + RING * Math.sin(r)) };
});

// The incident card, and the warning signs that merge into it.
const CARD = { x: 548, y: 462, w: 200, h: 100 };
const CHIP_Y = CARD.y + 50;
const SIGNALS: { id: string; source: "rule" | "ai"; w: number; from: number }[] = [
  { id: "CS-1", source: "rule", w: 34, from: 0 },
  { id: "CS-2", source: "rule", w: 34, from: 1 },
  { id: "CS-3", source: "rule", w: 34, from: 2 },
  { id: "ATDE", source: "ai", w: 36, from: 3 },
  { id: "ATO-1", source: "rule", w: 42, from: 5 },
];
const CHIP_SLOTS = (() => {
  let x = CARD.x + 14;
  return SIGNALS.map((s) => {
    const at = x;
    x += s.w + 4;
    return at;
  });
})();

function Address({ t, i, at, label }: { t: MotionValue<number>; i: number; at: Pt; label: string }) {
  const start = 1.25 + i * 0.04;
  const opacity = useTransform(t, [start, start + 0.08], [0, 1]);
  const draw = useTransform(t, [start + 0.02, start + 0.14], [0, 1]);
  return (
    <g>
      <motion.line x1={at.x} y1={at.y} x2={ACCOUNT.x} y2={ACCOUNT.y} className={styles.link} style={{ pathLength: draw, opacity }} />
      <motion.g style={{ opacity }}>
        <circle cx={at.x} cy={at.y} r="7" className={styles.address} />
        <text x={at.x} y={at.y + 20} className={styles.addressLabel}>
          {label}
        </text>
      </motion.g>
    </g>
  );
}

function SignalChip({ t, i }: { t: MotionValue<number>; i: number }) {
  const s = SIGNALS[i];
  const from = ADDRESSES[s.from].at;
  const start = { x: from.x + 10, y: from.y - 26 };
  const end = { x: CHIP_SLOTS[i], y: CHIP_Y };
  const appear = useTransform(t, [1.5 + i * 0.02, 1.58 + i * 0.02], [0, 1]);
  const merge = useTransform(t, [1.6 + i * 0.02, 1.8], [0, 1]);
  const x = useTransform(merge, (m) => (start.x - end.x) * (1 - m));
  const y = useTransform(merge, (m) => (start.y - end.y) * (1 - m));
  return (
    <motion.g style={{ x, y, opacity: appear }}>
      <g transform={`translate(${end.x} ${end.y})`}>
        <rect width={s.w} height="17" rx="4" className={s.source === "rule" ? styles.chipRule : styles.chipAi} />
        <text x={s.w / 2} y="12" className={s.source === "rule" ? styles.chipTextRule : styles.chipTextAi}>
          {s.id}
        </text>
      </g>
    </motion.g>
  );
}

export function CorrelateLayer({ t }: { t: MotionValue<number> }) {
  const account = useTransform(t, [1.15, 1.28], [0, 1]);
  const card = useTransform(t, [1.66, 1.76], [0, 1]);
  const notes = useTransform(t, [1.8, 1.88], [0, 1]);
  const w = ACCOUNT_NAME.length * 7 + 18;

  return (
    <svg viewBox="0 0 760 760" className={styles.layer} aria-hidden="true">
      {ADDRESSES.map((a, i) => (
        <Address key={a.label} t={t} i={i} at={a.at} label={a.label} />
      ))}

      <motion.g style={{ opacity: account }}>
        <rect x={ACCOUNT.x - w / 2} y={ACCOUNT.y - 12} width={w} height="24" rx="6" className={styles.account} />
        <text x={ACCOUNT.x} y={ACCOUNT.y + 4.5} className={styles.accountText}>
          {ACCOUNT_NAME}
        </text>
      </motion.g>

      <motion.g style={{ opacity: card }}>
        <rect x={CARD.x} y={CARD.y} width={CARD.w} height={CARD.h} rx="10" className={styles.card} />
        <text x={CARD.x + 14} y={CARD.y + 20} className={styles.cardLabel}>
          ONE INCIDENT
        </text>
        <text x={CARD.x + 14} y={CARD.y + 39} className={styles.cardTitle}>
          Credential stuffing
        </text>
        <text x={CARD.x + 14} y={CARD.y + 87} className={styles.cardMeta}>
          6 ADDRESSES, 1 ACCOUNT
        </text>
      </motion.g>

      {SIGNALS.map((s, i) => (
        <SignalChip key={s.id} t={t} i={i} />
      ))}

      {/* plain-language notes */}
      <motion.g style={{ opacity: notes }}>
        <text x={ADDRESSES[1].at.x - 18} y={ADDRESSES[1].at.y + 42} className={styles.note}>
          6 addresses, one campaign
        </text>
      </motion.g>
    </svg>
  );
}
