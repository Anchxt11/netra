// NEEDS ATTENTION: the ranked queue. Spec: docs/PAGES.md, "Left". Order comes only from src/lib/rank.ts.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useLocation } from "react-router-dom";
import { Panel } from "../../components/Panel";
import { QueueRow } from "../../components/QueueRow";
import { TierEmpty, TierHeader } from "../../components/TierHeader";
import { TIER_ORDER } from "../../lib/rank";
import { formatHM } from "../../lib/time";
import { useNetra, useRankedIncidents, type Selection } from "../../store/useNetra";
import styles from "./Queue.module.css";

const LAYOUT = { layout: { duration: 0.22, ease: "easeOut" as const } };
// A new row's one-time flash (rust, fading out).
const FLASH_ON = "rgba(227, 90, 54, 0.28)";
const FLASH_OFF = "rgba(227, 90, 54, 0)";
// How long "+N alerts" stays on a row after a repeated attack joins it.
const BUMP_MS = 8_000;


export function Queue() {
  const ranked = useRankedIncidents();
  const selection = useNetra((s) => s.selection);
  const select = useNetra((s) => s.select);
  const benign = useNetra((s) => s.benign);
  const expired = useNetra((s) => s.expired);
  const expiredCount = useNetra((s) => s.health?.expiredToday ?? s.expired.length);
  const judgedCount = useNetra((s) => s.health?.judgedNormalToday ?? s.benign.length);
  const [showExpired, setShowExpired] = useState(false);
  const location = useLocation();
  const judgedRef = useRef<HTMLButtonElement>(null);
  const expiredRef = useRef<HTMLButtonElement>(null);

  // Rows that arrive after the first load slide in and flash once. Ids are marked as
  // seen after each commit, so the first render of a new row is the only "fresh" one.
  const seen = useRef<Set<string> | null>(null);
  const isNew = (id: string) => seen.current !== null && !seen.current.has(id);
  useEffect(() => {
    if (ranked.length === 0) return;
    if (seen.current === null) seen.current = new Set();
    for (const i of ranked) seen.current.add(i.id);
  }, [ranked]);

  // A repeated attack joins its open incident (same attack, same source) instead of adding a row.
  // Say so on the row: "+N alerts" for a few seconds whenever the incident's alert count grows.
  const counts = useRef(new Map<string, number>());
  const [bumps, setBumps] = useState<Map<string, { n: number; until: number }>>(new Map());
  useEffect(() => {
    const now = Date.now();
    let next: Map<string, { n: number; until: number }> | null = null;
    for (const i of ranked) {
      if (i.alerts === undefined) continue;
      const prev = counts.current.get(i.id);
      counts.current.set(i.id, i.alerts);
      if (prev === undefined || i.alerts <= prev) continue;
      next ??= new Map(bumps);
      const live = next.get(i.id);
      next.set(i.id, { n: (live && live.until > now ? live.n : 0) + i.alerts - prev, until: now + BUMP_MS });
    }
    if (next) setBumps(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bumps is read only to extend a live count
  }, [ranked]);
  const bumpOf = (id: string) => {
    const b = bumps.get(id);
    return b && b.until > Date.now() ? b.n : undefined;
  };

  // The top-bar chips link here with #expired or #judged-normal.
  useEffect(() => {
    if (location.hash === "#expired") {
      setShowExpired(true);
      expiredRef.current?.focus();
    } else if (location.hash === "#judged-normal") {
      judgedRef.current?.focus();
    }
  }, [location.key, location.hash]);

  const isSelected = (sel: Selection) => selection?.kind === sel?.kind && selection?.id === sel?.id;
  const latestBenign = benign[0];
  const firstBenign = useRef<string | undefined>(undefined);
  if (firstBenign.current === undefined && latestBenign) firstBenign.current = latestBenign.id;

  // Up and Down arrows move the selection through the rows.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-row]")];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    e.preventDefault();
    const next = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
    next.focus();
    next.click();
  };

  const items = TIER_ORDER.flatMap((tier) => {
    const rows = ranked.filter((i) => i.rank.tier === tier);
    return [
      <motion.div key={`h-${tier}`} layout="position" transition={LAYOUT}>
        <TierHeader tier={tier} count={rows.length} />
      </motion.div>,
      ...(rows.length === 0
        ? [
            <motion.div key={`e-${tier}`} layout="position" transition={LAYOUT} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <TierEmpty />
            </motion.div>,
          ]
        : rows.map((i) => {
            const fresh = isNew(i.id);
            return (
              <motion.div
                key={i.id}
                layout="position"
                initial={fresh ? { opacity: 0, x: -14, backgroundColor: FLASH_ON } : false}
                animate={{ opacity: 1, x: 0, backgroundColor: FLASH_OFF }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                transition={{ ...LAYOUT, backgroundColor: { duration: 0.9, delay: 0.2 } }}
                className={styles.rowWrap}
                title={i.name}
              >
                <QueueRow
                  score={i.attentionScore}
                  name={i.name}
                  detectedBy={i.detectedBy}
                  mitreId={i.mitre.id}
                  remaining={i.rank.remaining}
                  timeLeftMs={i.rank.timeLeftMs}
                  selected={isSelected({ kind: "incident", id: i.id })}
                  dimmed={tier === "WATCH"}
                  bump={bumpOf(i.id)}
                  source={i.entities.ips.length === 1 ? i.entities.ips[0] : i.entities.ips.length > 1 ? `${i.entities.ips.length} addresses` : undefined}
                  onSelect={() => select({ kind: "incident", id: i.id })}
                />
              </motion.div>
            );
          })),
    ];
  });

  return (
    <Panel title="Needs attention" corners={["tl", "br"]} className={styles.panel} tourId="queue">
      <div className={styles.list} onKeyDown={onKeyDown}>
        <AnimatePresence initial={false} mode="popLayout">
          {items}
        </AnimatePresence>
      </div>

      <div className={styles.pinned}>
        <button
          ref={judgedRef}
          type="button"
          id="judged-normal"
          className={`${styles.group} ${styles.judged} ${latestBenign && isSelected({ kind: "benign", id: latestBenign.id }) ? styles.groupSelected : ""}`}
          aria-pressed={latestBenign ? isSelected({ kind: "benign", id: latestBenign.id }) : false}
          disabled={!latestBenign}
          onClick={() => latestBenign && select({ kind: "benign", id: latestBenign.id })}
        >
          {/* A newly judged-normal item flashes the group once (not on first load). */}
          {latestBenign && latestBenign.id !== firstBenign.current && (
            <motion.i
              key={latestBenign.id}
              className={styles.groupFlash}
              initial={{ opacity: 0.5 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 1.4, ease: "easeOut" }}
              aria-hidden="true"
            />
          )}
          <span className={styles.groupName}>Judged normal · {judgedCount}</span>
          {latestBenign && (
            <span className={styles.latest}>
              {latestBenign.name}, {formatHM(latestBenign.ts)}
            </span>
          )}
        </button>

        <button
          ref={expiredRef}
          type="button"
          id="expired"
          className={`${styles.group} ${styles.expired}`}
          aria-expanded={showExpired}
          aria-controls="expired-list"
          onClick={() => setShowExpired((v) => !v)}
        >
          <i className={styles.staleMark} aria-hidden="true" />
          <span className={styles.groupName}>Expired · {expiredCount}</span>
          <span className={styles.toggle}>{showExpired ? "Hide" : "Show"}</span>
        </button>
        {showExpired && (
          <ul id="expired-list" className={styles.expiredList}>
            {expired.length === 0 && <li className={styles.none}>None yet this session.</li>}
            {expired.map((i) => (
              <li key={i.id}>
                <span className={styles.expId}>{i.id}</span>
                <span className={styles.expName}>{i.name}</span>
                <span className={styles.expAt}>{formatHM(i.staleBy)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
