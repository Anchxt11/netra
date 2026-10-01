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
  /** Lets the first-visit tour point at this box. */
  tourId?: string;
}

/** Opaque module for reading data, with a clear header bar: the title, its context, a divider. */
export function Panel({ title, meta, corners = [], className, children, tourId }: Props) {
  return (
    <section className={className ? `${styles.panel} ${className}` : styles.panel} data-tour={tourId}>
      {corners.map((c) => (
        <i key={c} className={`${styles.corner} ${styles[c]}`} aria-hidden="true" />
      ))}
      <header className={styles.head}>
        <BoxTitle>{title}</BoxTitle>
        {meta && <span className={styles.meta}>{meta}</span>}
      </header>
      {children}
    </section>
  );
}

/** A box's title. Used on panels and glass cards alike. */
export function BoxTitle({ children }: { children: ReactNode }) {
  return <h2 className={styles.title}>{children}</h2>;
}
