// The product shot under the hero: a miniature of the live dashboard, drawn from the same live
// store (so its numbers are the feed's own, never made up). Laid out on the 680x420 frame the
// globe's dots re-form into (dashboardOutline.SHOT), then scaled to fit.
import { useEffect, useRef, useState } from "react";
import { heatColor } from "../lib/heat";
import { formatCountdown } from "../lib/time";
import { useNetra, useRankedIncidents } from "../store/useNetra";
import { SHOT } from "./dashboardOutline";
import styles from "./ProductShot.module.css";

const RING = 48;

export function ProductShot() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  const ranked = useRankedIncidents();
  const eps = useNetra((s) => s.health?.eventsPerSec);
  const traffic = useNetra((s) => s.traffic);
  const feed = useNetra((s) => s.feed);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setK(el.clientWidth / SHOT.w));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const top = ranked[0];
  const left = top?.rank.remaining ?? 0;
  const lit = Math.ceil(left * RING);
  const bars = traffic.slice(-19);
  const max = Math.max(1, ...bars.map((t) => t.normal + t.rule + t.ai));
  const epsText = eps === undefined ? "" : String(eps);

  return (
    <div ref={wrapRef} className={styles.wrap} aria-hidden="true">
      <div className={styles.shot} style={{ transform: `scale(${k})` }}>
        <div className={styles.queue}>
          <span className={styles.label}>Needs attention</span>
          {ranked.slice(0, 7).map((i, n) => (
            <span key={i.id} className={`${styles.row} ${n === 0 ? styles.sel : ""}`}>
              <i style={{ background: heatColor(i.rank.remaining) }} />
              <span className={styles.rowName}>{i.name}</span>
              <span className={styles.mono}>{formatCountdown(i.rank.timeLeftMs)}</span>
            </span>
          ))}
        </div>

        <div className={styles.hero}>
          {top && (
            <>
              <span className={styles.meta}>
                <span className={styles.pill}>{top.rank.tier}</span> Incident {top.id}
              </span>
              <span className={styles.name}>{top.name}</span>
              <span className={styles.fix}>Fix</span>
              <span className={styles.ringWrap}>
                <svg viewBox="0 0 120 120" className={styles.ring}>
                  {Array.from({ length: RING }, (_, s) => (
                    <rect
                      key={s}
                      x="58"
                      y="4"
                      width="4"
                      height="11"
                      rx="2"
                      fill={s < lit ? heatColor(left) : "var(--unlit)"}
                      transform={`rotate(${(s * 360) / RING} 60 60)`}
                    />
                  ))}
                </svg>
                <span className={styles.count}>{formatCountdown(top.rank.timeLeftMs)}</span>
              </span>
              <span className={styles.steps}>
                {top.signals.slice(0, 6).map((s, n) => (
                  <i key={s.id} style={{ bottom: `${(n + 1) * 14}%`, left: `${n * 16}%`, background: s.ruleId === "ATDE" ? "var(--ai)" : "var(--rust)" }} />
                ))}
              </span>
            </>
          )}
        </div>

        {["Threat scope", "Who is involved", "Detections / min", "System"].map((t, n) => (
          <span key={t} className={styles.tile} style={{ left: 166 + n * 91 }}>
            {t}
          </span>
        ))}

        <div className={styles.feed}>
          <span className={styles.label}>Live feed</span>
          <span className={styles.eps}>
            {epsText.slice(0, -1)}
            <span className={styles.faint}>{epsText.slice(-1)}</span>
          </span>
          <span className={styles.bars}>
            {bars.map((b, n) => (
              <i key={n} style={{ height: `${((b.normal + b.rule + b.ai) / max) * 100}%`, background: (b.rule + b.ai) / Math.max(1, b.normal + b.rule + b.ai) > 0.04 ? "var(--rust)" : "rgba(243,240,236,.3)" }} />
            ))}
          </span>
          {feed.slice(0, 10).map((e) => (
            <span key={e.id} className={`${styles.ev} ${e.flag ? styles.flagged : ""}`}>
              {e.what}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
