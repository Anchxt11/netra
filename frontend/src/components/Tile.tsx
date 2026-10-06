// A compact tile that opens upward on hover, keyboard focus or click, and closes with Esc.
// Closed it shows one line or one small drawing; open, the full content. DESIGN.md v2, "Alive on contact".
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./Tile.module.css";

interface Props {
  title: string;
  /** Right of the title, e.g. "9 open". */
  meta?: ReactNode;
  /** What the closed tile shows under the title. */
  summary: ReactNode;
  /** The full content. Rendered only while open, so heavy charts never run hidden. */
  children: ReactNode;
  tourId?: string;
  /** Open tiles are twice as wide; they grow towards this side. */
  grow?: "left" | "right";
}

export function Tile({ title, meta, summary, children, tourId, grow = "right" }: Props) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || focus || pinned;
  const id = useId();

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setPinned(false);
      setHover(false);
      (e.currentTarget.querySelector("button") as HTMLButtonElement | null)?.blur();
      setFocus(false);
    }
  };

  return (
    <div
      className={styles.slot}
      data-tour={tourId}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
      onKeyDown={onKeyDown}
    >
      <div className={`${styles.tile} ${open ? `${styles.open} ${styles[grow]}` : ""}`}>
        <button type="button" className={styles.head} aria-expanded={open} aria-controls={id} onClick={() => setPinned((p) => !p)}>
          <span className={styles.title}>{title}</span>
          {meta !== undefined && <span className={styles.meta}>{meta}</span>}
        </button>
        <div className={styles.summary} aria-hidden={open}>
          {summary}
        </div>
        <div id={id} className={styles.body} role="region" aria-label={title}>
          {open && children}
        </div>
      </div>
    </div>
  );
}
