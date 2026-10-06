// OSD = on-screen display: the live status readouts either side of the top bar.
import { Link } from "react-router-dom";
import { Chip } from "../../components/Chip";
import { NumText } from "../../components/NumText";
import { formatClock } from "../../lib/time";
import { useNetra } from "../../store/useNetra";
import { useSession } from "../../store/useSession";
import styles from "./Osd.module.css";

const TRACE_W = 46;
const TRACE_H = 16;

/**
 * The feed's own heartbeat: a small trace of events per second over the last 30 s.
 * Moves only because data arrives. Flatlines and turns pink when the feed fails.
 */
function FeedTrace() {
  const history = useNetra((s) => s.epsHistory);
  const feed = useNetra((s) => s.health?.feed ?? "live");
  const connection = useNetra((s) => s.connection);
  const lost = connection === "closed";
  const failing = lost || feed !== "live";
  const waiting = connection === "connecting" && !failing;

  const max = Math.max(1, ...history);
  const min = Math.min(...history, max);
  const span = Math.max(1, max - min);
  const step = TRACE_W / Math.max(1, history.length - 1);
  const points = history
    .map((v, i) => `${(i * step).toFixed(1)},${(TRACE_H - 2 - ((v - min) / span) * (TRACE_H - 4)).toFixed(1)}`)
    .join(" ");
  // The connection comes first: a feed can only be live over a working connection.
  const label = lost
    ? "RECONNECTING"
    : waiting
      ? "CONNECTING"
      : feed === "live"
        ? "LIVE"
        : feed === "stalled"
          ? "FEED STALLED"
          : "FEED DOWN";

  return (
    <span
      className={`${styles.feed} ${failing ? styles.failing : ""} ${waiting ? styles.waiting : ""}`}
      role="status"
      aria-label={`Live feed status: ${label}`}
    >
      <svg width={TRACE_W} height={TRACE_H} aria-hidden="true">
        <line x1="0" y1={TRACE_H - 0.5} x2={TRACE_W} y2={TRACE_H - 0.5} className={styles.base} />
        {failing || waiting ? (
          <line x1="0" y1={TRACE_H / 2} x2={TRACE_W} y2={TRACE_H / 2} className={styles.trace} />
        ) : (
          history.length > 1 && <polyline points={points} className={styles.trace} />
        )}
      </svg>
      <span aria-hidden="true">{label}</span>
    </span>
  );
}

/** Freshness SLA: time from an event arriving to a ranked alert on screen. p95 against a 5 s target. */
function Freshness() {
  const health = useNetra((s) => s.health);
  if (!health?.freshnessMs) return <span className={styles.label}>FRESHNESS PENDING</span>;
  const p95 = health.freshnessMs.p95;
  const over = p95 > health.slaMs;
  const lit = Math.max(1, Math.min(10, Math.round((p95 / health.slaMs) * 10)));
  const value = `${(p95 / 1000).toFixed(1)}S/${health.slaMs / 1000}S`;
  return (
    <span className={`${styles.fresh} ${over ? styles.failing : ""}`} aria-label={`Freshness p95 ${value}${over ? ", over target" : ""}`}>
      <span className={`${styles.label} ${styles.freshLabel}`}>FRESHNESS</span>
      <span className={styles.segs} aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={i < lit ? styles.lit : undefined} />
        ))}
      </span>
      <span className={styles.value} aria-hidden="true">
        {value}
        {over && " OVER TARGET"}
      </span>
    </span>
  );
}

/** Left of the bar: is the feed alive, what time is it, how fresh is the data. */
export function OsdStatus() {
  const now = useNetra((s) => s.now);
  return (
    <div className={styles.status} data-tour="status">
      <FeedTrace />
      <NumText value={formatClock(now)} size="m" className={styles.clock} />
      <Freshness />
    </div>
  );
}

/** The landing page shows live readouts too, so it carries the honesty chip on its own. */
export function SimulatedChip() {
  const simulated = useNetra((s) => s.simulated);
  if (!simulated) return null;
  return (
    <div className={styles.chips}>
      <Chip tone="muted" dashed>
        SIMULATED FEED
      </Chip>
    </div>
  );
}

/** Right of the bar: today's counts and the honesty chip. */
export function OsdChips() {
  const expired = useNetra((s) => s.health?.expiredToday ?? s.expired.length);
  const judgedNormal = useNetra((s) => s.health?.judgedNormalToday ?? s.benign.length);
  const simulated = useNetra((s) => s.simulated);
  const openTour = useNetra((s) => s.setTourOpen);
  return (
    <div className={styles.chips}>
      <button type="button" className={styles.tourButton} onClick={() => openTour(true)} aria-label="Start the guided tour of the dashboard">
        TOUR
      </button>
      <Link to="/live#expired" className={styles.chipLink}>
        <Chip>EXPIRED {expired}</Chip>
      </Link>
      <Link to="/live#judged-normal" className={styles.chipLink}>
        <Chip tone="ok">JUDGED NORMAL {judgedNormal}</Chip>
      </Link>
      {simulated && (
        <Chip tone="muted" dashed>
          SIMULATED FEED
        </Chip>
      )}
      <SignedIn />
    </div>
  );
}

/** On the real backend: who is signed in, and the way out. */
function SignedIn() {
  const session = useSession((s) => s.session);
  const signOut = useSession((s) => s.signOut);
  if (!session) return null;
  const { username, role } = session.user;
  return (
    <>
      <Chip tone="muted">
        <span className="visually-hidden">Signed in as </span>
        {username.toLowerCase() === role ? role.toUpperCase() : `${role.toUpperCase()} ${username.toUpperCase()}`}
      </Chip>
      <button type="button" className={styles.tourButton} onClick={() => signOut()}>
        SIGN OUT
      </button>
    </>
  );
}
