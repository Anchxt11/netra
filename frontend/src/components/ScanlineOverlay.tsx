import styles from "./ScanlineOverlay.module.css";

interface Props {
  /** 0 to 1. DESIGN.md says 0.12; the console keeps it lower. */
  strength?: number;
}

/** A 1px dark line every 3px over the whole screen. Never animated. */
export function ScanlineOverlay({ strength = 0.12 }: Props) {
  return <div className={styles.scan} style={{ opacity: strength }} aria-hidden="true" />;
}
