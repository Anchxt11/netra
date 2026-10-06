// How it works: five still drawings that come alive on hover or keyboard focus (Stripe style).
// Replaces v1's pinned scroll story. DESIGN.md v2, "Alive on contact".
import styles from "./HowItWorks.module.css";

const DOTS: [number, number][] = [
  [20, 30], [60, 30], [100, 30], [140, 30], [180, 30], [220, 30],
  [20, 80], [60, 80], [140, 80], [180, 80], [220, 80],
  [20, 130], [60, 130], [100, 130], [140, 130], [220, 130],
];

export function HowItWorks() {
  return (
    <div className={styles.grid}>
      <article className={`${styles.card} ${styles.wide}`} tabIndex={0}>
        <span className={styles.step}>01 · Ingest</span>
        <svg viewBox="0 0 300 160" className={styles.art} aria-hidden="true">
          <path className={styles.flow} d="M0 30 C 100 30, 160 80, 300 80" />
          <path className={styles.flow} d="M0 80 L 300 80" />
          <path className={styles.flow} d="M0 130 C 100 130, 160 80, 300 80" />
          <circle cx="290" cy="80" r="10" className={styles.target} />
        </svg>
        <h3 className={styles.text}>Every login, request and network flow streams in live.</h3>
      </article>

      <article className={`${styles.card} ${styles.wide}`} tabIndex={0}>
        <span className={styles.step}>02 · Detect</span>
        <svg viewBox="0 0 260 160" className={styles.art} aria-hidden="true">
          {DOTS.map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="4" className={styles.dot} />
          ))}
          <circle cx="100" cy="80" r="6" className={`${styles.dot} ${styles.hitRule}`} />
          <circle cx="180" cy="130" r="6" className={`${styles.dot} ${styles.hitAi}`} />
          <rect x="0" y="10" width="3" height="140" className={styles.scan} />
        </svg>
        <h3 className={styles.text}>
          Rules catch the known. <span className={styles.ai}>The AI engine</span> checks what rules let through.
        </h3>
      </article>

      <article className={styles.card} tabIndex={0}>
        <span className={styles.step}>03 · Correlate</span>
        <svg viewBox="0 0 200 160" className={styles.art} aria-hidden="true">
          {[
            [40, 30],
            [160, 30],
            [30, 130],
            [170, 130],
          ].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <line x1={x} y1={y} x2="100" y2="80" className={styles.link} />
              <circle cx={x} cy={y} r="6" className={styles.node} />
            </g>
          ))}
          <rect x="78" y="68" width="44" height="24" rx="12" className={styles.account} />
        </svg>
        <h3 className={styles.text}>Small signs from one source become one incident.</h3>
      </article>

      <article className={styles.card} tabIndex={0}>
        <span className={styles.step}>04 · Prioritise</span>
        <svg viewBox="0 0 160 160" className={styles.art} aria-hidden="true">
          <path className={`${styles.seg} ${styles.s1}`} d="M80 14 A66 66 0 0 1 146 80" />
          <path className={`${styles.seg} ${styles.s2}`} d="M146 80 A66 66 0 0 1 80 146" />
          <path className={`${styles.seg} ${styles.s3}`} d="M80 146 A66 66 0 0 1 14 80" />
          <path className={`${styles.seg} ${styles.s4}`} d="M14 80 A66 66 0 0 1 80 14" />
          <text x="80" y="88" textAnchor="middle" className={styles.clock}>
            06:04
          </text>
        </svg>
        <h3 className={styles.text}>Each incident has a deadline. Less time left, higher in the queue.</h3>
      </article>

      <article className={styles.card} tabIndex={0}>
        <span className={styles.step}>05 · Recommend</span>
        <svg viewBox="0 0 200 160" className={styles.art} aria-hidden="true">
          <g className={`${styles.fan} ${styles.fanLeft}`}>
            <rect x="62" y="40" width="76" height="96" rx="12" className={styles.back} />
          </g>
          <g className={`${styles.fan} ${styles.fanRight}`}>
            <rect x="62" y="40" width="76" height="96" rx="12" className={styles.back} />
          </g>
          <rect x="62" y="34" width="76" height="96" rx="12" className={styles.front} />
          <rect x="74" y="50" width="40" height="6" rx="3" className={styles.bar1} />
          <rect x="74" y="64" width="52" height="4" rx="2" className={styles.bar2} />
          <circle cx="100" cy="102" r="14" className={styles.tick} />
          <path d="M93 102 l5 5 l9 -10" className={styles.tickMark} />
        </svg>
        <h3 className={styles.text}>Three fixes, explained. A person approves.</h3>
      </article>
    </div>
  );
}
