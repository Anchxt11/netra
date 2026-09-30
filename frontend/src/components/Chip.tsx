import type { ReactNode } from "react";
import styles from "./Chip.module.css";

export type ChipTone = "neutral" | "rust" | "soon" | "watch" | "ok" | "rule" | "ai" | "fail" | "muted";

interface Props {
  tone?: ChipTone;
  /** Solid fill (ACT NOW, going-cold time). Otherwise an outline. */
  solid?: boolean;
  /** Dashed outline, for "SIMULATED FEED". */
  dashed?: boolean;
  /** Small square in the chip's colour before the text. */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

/** Fully round, 22px, IBM Plex Mono 11px, uppercase. */
export function Chip({ tone = "neutral", solid, dashed, dot, className, children }: Props) {
  const cls = [styles.chip, styles[tone], solid && styles.solid, dashed && styles.dashed, className]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls}>
      {dot && <i className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** "DETECTED BY RULES + AI": violet half, then cyan half. */
export function SplitChip({ left, right }: { left: string; right: string }) {
  return (
    <span className={styles.split}>
      <span className={styles.splitRule}>{left}</span>
      <span className={styles.splitAi}>{right}</span>
    </span>
  );
}
