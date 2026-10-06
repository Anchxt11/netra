// LIVE FEED: the traffic itself, normal events included (PAGES.md "Right: Live feed").
// Every event counts in the chart; the list shows a sample, flagged ones first. Pauses on hover.
import { useMemo, useState } from "react";
import { formatClock } from "../../lib/time";
import { useNetra } from "../../store/useNetra";
import styles from "./LiveFeed.module.css";

const SECONDS = 60;

export function LiveFeed() {
  const traffic = useNetra((s) => s.traffic);
  const feed = useNetra((s) => s.feed);
  const eps = useNetra((s) => s.health?.eventsPerSec);
  const failing = useNetra((s) => s.connection === "closed" || (s.health ? s.health.feed !== "live" : false));
  const [paused, setPaused] = useState<typeof feed | null>(null);
  const rows = paused ?? feed;

  const { bars, flaggedPct } = useMemo(() => {
    const last = traffic.slice(-SECONDS);
    const max = Math.max(1, ...last.map((t) => t.normal + t.rule + t.ai));
    let all = 0;
    let flagged = 0;
    for (const t of last) {
      all += t.normal + t.rule + t.ai;
      flagged += t.rule + t.ai;
    }
    const pad = Array.from({ length: SECONDS - last.length }, () => null);
    return {
      bars: [...pad, ...last].map((t) => (t ? { n: (t.normal / max) * 100, r: (t.rule / max) * 100, a: (t.ai / max) * 100 } : null)),
      flaggedPct: all > 0 ? (flagged / all) * 100 : null,
    };
  }, [traffic]);

  const epsText = eps === undefined ? null : String(eps);

  return (
    <section className={styles.feed} aria-label="Live feed: all traffic" data-tour="feed">
      <div className={styles.head}>
        <span className={styles.title}>Live feed</span>
        <span className={styles.meta}>all traffic</span>
      </div>

      <div className={styles.big}>
        {epsText === null ? (
          <span className={styles.pending}>PENDING</span>
        ) : (
          <span className={`${styles.number} ${failing ? styles.failing : ""}`}>
            {epsText.slice(0, -1)}
            <span className={styles.faint}>{epsText.slice(-1)}</span>
          </span>
        )}
        <span className={styles.unit}>events / s</span>
        {flaggedPct !== null && (
          <span className={styles.flagged}>{flaggedPct < 1 ? flaggedPct.toFixed(1) : Math.round(flaggedPct)}% flagged</span>
        )}
      </div>

      <div className={styles.bars} role="img" aria-label="Events per second over the last minute: normal, flagged by a rule, flagged by the AI">
        {bars.map((b, i) => (
          <span key={i} className={styles.bar}>
            {b && (
              <>
                <i className={styles.ai} style={{ height: `${b.a}%` }} />
                <i className={styles.rule} style={{ height: `${b.r}%` }} />
                <i className={styles.normal} style={{ height: `${b.n}%` }} />
              </>
            )}
          </span>
        ))}
      </div>
      <div className={styles.legend}>
        <span>60 s ago</span>
        <span>
          <i className={styles.keyNormal} /> normal <i className={styles.keyRule} /> rule <i className={styles.keyAi} /> AI
        </span>
        <span>now</span>
      </div>

      <div className={styles.listHead}>
        <span>Latest events</span>
        <span>{paused ? "paused while you look" : "sampled"}</span>
      </div>
      <ol className={styles.list} onMouseEnter={() => setPaused(feed)} onMouseLeave={() => setPaused(null)}>
        {rows.length === 0 && <li className={styles.empty}>Waiting for the first events.</li>}
        {rows.map((e) => (
          <li key={e.id} className={`${styles.row} ${e.flag ? styles.flaggedRow : ""}`}>
            <span className={styles.time}>{formatClock(e.ts)}</span>
            <span className={styles.ip}>{e.ip}</span>
            <span className={styles.what}>{e.what}</span>
            {e.flag && <span className={e.flag.by === "ai" ? styles.tagAi : styles.tagRule}>{e.flag.label}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
