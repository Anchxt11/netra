// Step 3 (CORRELATE): six attacking addresses appear around auth-01, each drawing a line to the one
// account they all target. Their warning signs pop up, then glide together into ONE INCIDENT.
// Drawn like the dashboard's WHO IS INVOLVED graph (addresses = rust rings, target = solid rust).
// Scroll-driven through `t` (1 = step 2 settled, 2 = step 3 settled). All SVG, so it stays crisp.
import { motion, useTransform, type MotionValue } from "motion/react";
import type { Pt } from "./networkGeometry";
import {
  ACCOUNT,
  ACCOUNT_NAME,
  ACCOUNT_NOTE,
  ACCOUNT_W,
  ADDRESSES,
  CARD,
  CHIP_SLOTS,
  CHIP_Y,
  PLATE_W,
  SIGNALS,
} from "./correlateGeometry";
import styles from "./CorrelateLayer.module.css";

function Address({ t, i, at, label, above }: { t: MotionValue<number>; i: number; at: Pt; label: string; above: boolean }) {
  const start = 1.25 + i * 0.04;
  const opacity = useTransform(t, [start, start + 0.08], [0, 1]);
  const draw = useTransform(t, [start + 0.02, start + 0.14], [0, 1]);
  return (
    <g>
      <motion.line x1={at.x} y1={at.y} x2={ACCOUNT.x} y2={ACCOUNT.y} className={styles.link} style={{ pathLength: draw, opacity }} />
      <motion.g style={{ opacity }}>
        <circle cx={at.x} cy={at.y} r="7" className={styles.address} />
        <text x={at.x} y={above ? at.y - 13 : at.y + 20} className={styles.addressLabel}>
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
  // Moving on to step 4: the whole drawing hands over to its pixels.
  const layer = useTransform(t, [2.04, 2.1], [1, 0]);

  return (
    <motion.svg viewBox="0 0 760 760" className={styles.layer} style={{ opacity: layer }} aria-hidden="true">
      {ADDRESSES.map((a, i) => (
        <Address key={a.label} t={t} i={i} at={a.at} label={a.label} above={a.above} />
      ))}

      {/* the account, as one two-part tag: the name in solid rust, then what it means */}
      <motion.g style={{ opacity: account }}>
        <rect x={ACCOUNT.x + ACCOUNT_W / 2 - 6} y={ACCOUNT.y - 12} width={PLATE_W + 6} height="24" rx="6" className={styles.plate} />
        <text x={ACCOUNT.x + ACCOUNT_W / 2 + 10} y={ACCOUNT.y + 4.5} className={styles.plateText}>
          {ACCOUNT_NOTE}
        </text>
        <rect x={ACCOUNT.x - ACCOUNT_W / 2} y={ACCOUNT.y - 12} width={ACCOUNT_W} height="24" rx="6" className={styles.account} />
        <text x={ACCOUNT.x} y={ACCOUNT.y + 4.5} className={styles.accountText}>
          {ACCOUNT_NAME}
        </text>
      </motion.g>

      <motion.g style={{ opacity: card }}>
        <rect x={CARD.x} y={CARD.y} width={CARD.w} height={CARD.h} rx="10" className={styles.card} />
        <text x={CARD.x + 14} y={CARD.y + 20} className={styles.cardLabel}>
          ONE INCIDENT
        </text>
        <text x={CARD.x + 14} y={CARD.y + 38} className={styles.cardTitle}>
          Credential stuffing
        </text>
        <text x={CARD.x + 14} y={CARD.y + 82} className={styles.cardMeta}>
          6 ADDRESSES, 1 ACCOUNT
        </text>
      </motion.g>

      {SIGNALS.map((s, i) => (
        <SignalChip key={s.id} t={t} i={i} />
      ))}

      {/* plain-language note */}
      <motion.g style={{ opacity: notes }}>
        <text x={ADDRESSES[1].at.x - 18} y={ADDRESSES[1].at.y + 42} className={styles.note}>
          6 addresses, one campaign
        </text>
      </motion.g>
    </motion.svg>
  );
}
