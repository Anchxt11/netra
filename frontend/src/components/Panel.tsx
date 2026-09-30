import type { ReactNode } from "react";
import styles from "./Panel.module.css";

type Corner = "tl" | "tr" | "bl" | "br";

interface Props {
  title: string;
  /** Muted text on the right of the title, e.g. "7 OPEN". */
  meta?: ReactNode;
  /** L-shaped ticks for key panels, usually two opposite corners. */
  corners?: Corner[];
  className?: string;
  children?: ReactNode;
}

/** Opaque module for reading data, titled with a bracket label: [ TITLE ]. */
export function Panel({ title, meta, corners = [], className, children }: Props) {
  return (
    <section className={className ? `${styles.panel} ${className}` : styles.panel}>
      {corners.map((c) => (
        <i key={c} className={`${styles.corner} ${styles[c]}`} aria-hidden="true" />
      ))}
      <header className={styles.head}>
        <BracketLabel>{title}</BracketLabel>
        {meta && <span className={styles.meta}>{meta}</span>}
      </header>
      {children}
    </section>
  );
}

/** "[ TITLE ]" with rust brackets. Used on panels and glass cards alike. */
export function BracketLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className={styles.bracket}>
      <b aria-hidden="true">[</b>
      {children}
      <b aria-hidden="true">]</b>
    </h2>
  );
}
