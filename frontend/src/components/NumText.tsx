import type { CSSProperties } from "react";
import styles from "./NumText.module.css";

type Size = "s" | "m" | "l" | "xl";

interface Props {
  value: string | number;
  /** s 15, m 24, l 26, xl 40 (px). Numerals under 15px use plain data text instead. */
  size?: Size;
  color?: string;
  className?: string;
}

/**
 * Every big number goes through here, so the numeral font can be swapped in one place
 * (--font-num). ":" and "." are always set in IBM Plex Mono, so they stay legible
 * even if a display face is used for the digits.
 */
export function NumText({ value, size = "m", color, className }: Props) {
  const parts = String(value).split(/([:.])/);
  const style: CSSProperties | undefined = color ? { color } : undefined;
  return (
    <span className={`${styles.num} ${styles[size]} ${className ?? ""}`} style={style}>
      {parts.map((p, i) =>
        p === ":" || p === "." ? (
          <span key={i} className={styles.punct}>
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </span>
  );
}
