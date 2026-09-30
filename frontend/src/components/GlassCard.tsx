import type { HTMLAttributes } from "react";
import styles from "./GlassCard.module.css";

/** Glass is for focus and decisions only. Never put dense data on it. */
export function GlassCard({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `${styles.glass} ${className}` : styles.glass} {...rest} />;
}
