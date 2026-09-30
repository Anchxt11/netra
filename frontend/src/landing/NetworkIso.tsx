// Step 2 (DETECT): "YOUR NETWORK" up close. Four servers, traffic streaming in; one stream turns
// yellow (fresh, suspicious data), a bracket locks on, then the rule and the AI engine say what
// they saw, each in a few plain words. Every reveal is driven by scroll through `t`
// (0 = step 1, 1 = step 2 settled). The globe's pixels assemble this drawing first (see Globe).
import { motion, useTransform, type MotionValue } from "motion/react";
import { SourceTag } from "../components/SourceTag";
import { EVENT_AT, FLOOR, HOT, HOSTS, STREAMS, blockCorners, iso, pathPoints, type Host, type Path, type Pt } from "./networkGeometry";
import styles from "./NetworkIso.module.css";

const pts = (list: Pt[]) => list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const toPts = (path: Path) => pts(pathPoints(path));
const pct = (v: number) => `${(v / 760) * 100}%`;
/** The server the attack is aimed at: it stays in focus from step 3. */
const FOCUS_HOST = "auth-01";

function Block({ host }: { host: Host }) {
  const { b, c, d, A, B, C, D } = blockCorners(host);
  return (
    <g>
      <polygon points={pts([d, c, C, D])} className={styles.faceLeft} />
      <polygon points={pts([c, b, B, C])} className={styles.faceRight} />
      <polygon points={pts([A, B, C, D])} className={styles.faceTop} />
    </g>
  );
}

function HostLabel({ host }: { host: Host }) {
  const { A } = blockCorners(host);
  return (
    <div className={styles.hostLabel} style={{ left: pct(A.x), top: pct(A.y - 44) }}>
      <span className={styles.hostName}>{host.name}</span>
      <span className={styles.hostRole}>{host.role}</span>
    </div>
  );
}

interface Props {
  t: MotionValue<number>;
}

export function NetworkIso({ t }: Props) {
  // Step 2 reveals (t 0.48 to 0.88), and step 3's hand-over (t just past 1): the step 2 notes go,
  // the streams stop and the other servers dim, leaving auth-01 (logins) in focus.
  // Step 4 hand-over (t just past 2): the drawing turns to pixels, so it fades as they appear.
  const drawing = useTransform(t, [0.48, 0.6, 2.04, 2.1], [0, 1, 1, 0]);
  const labels = useTransform(t, [0.56, 0.64, 1.04, 1.16], [0, 1, 1, 0]);
  const focusLabel = useTransform(t, [0.56, 0.64, 2.04, 2.1], [0, 1, 1, 0]);
  const hot = useTransform(t, [0.6, 0.68, 1.04, 1.18], [0, 1, 1, 0]);
  const bracketOpacity = useTransform(t, [0.66, 0.74, 1.02, 1.12], [0, 1, 1, 0]);
  const ruleTag = useTransform(t, [0.72, 0.8, 1.02, 1.12], [0, 1, 1, 0]);
  const aiTag = useTransform(t, [0.8, 0.88, 1.02, 1.12], [0, 1, 1, 0]);
  const streams = useTransform(t, [1.04, 1.18], [1, 0]);
  const others = useTransform(t, [1.04, 1.22], [1, 0.18]);
  const streamStart = iso(-2, -6.5);
  const focus = HOSTS.find((h) => h.name === FOCUS_HOST);

  return (
    <div className={styles.network} aria-hidden="true">
      <motion.svg viewBox="0 0 760 760" className={styles.svg} style={{ opacity: drawing }}>
        <g className={styles.floor}>
          {FLOOR.map((k) => (
            <g key={k}>
              <line x1={iso(k, -4).x} y1={iso(k, -4).y} x2={iso(k, 4).x} y2={iso(k, 4).y} />
              <line x1={iso(-4, k).x} y1={iso(-4, k).y} x2={iso(4, k).x} y2={iso(4, k).y} />
            </g>
          ))}
        </g>

        {/* incoming streams: dashes march toward the servers */}
        <motion.g style={{ opacity: streams }}>
          {STREAMS.map((s) => (
            <polyline key={s.id} points={toPts(s.path)} className={styles.stream} />
          ))}
          <polyline points={toPts(HOT)} className={styles.stream} />
        </motion.g>
        <motion.polyline points={toPts(HOT)} className={styles.hotStream} style={{ opacity: hot }} />

        {HOSTS.map((h) =>
          h.name === FOCUS_HOST ? (
            <Block key={h.name} host={h} />
          ) : (
            <motion.g key={h.name} style={{ opacity: others }}>
              <Block host={h} />
            </motion.g>
          ),
        )}

        {/* the suspicious event, and the bracket that locks onto it */}
        <motion.g style={{ opacity: hot }}>
          <rect x={EVENT_AT.x - 7} y={EVENT_AT.y - 7} width="14" height="14" className={styles.eventGlow} />
          <rect x={EVENT_AT.x - 3} y={EVENT_AT.y - 3} width="6" height="6" className={styles.event} />
        </motion.g>
        <motion.rect
          x={EVENT_AT.x - 16}
          y={EVENT_AT.y - 16}
          width="32"
          height="32"
          className={styles.bracket}
          style={{ opacity: bracketOpacity }}
        />
      </motion.svg>

      {/* plain-language labels */}
      <motion.div className={styles.labels} style={{ opacity: focusLabel }}>
        {focus && <HostLabel host={focus} />}
      </motion.div>
      <motion.div className={styles.labels} style={{ opacity: labels }}>
        {HOSTS.filter((h) => h.name !== FOCUS_HOST).map((h) => (
          <HostLabel key={h.name} host={h} />
        ))}
        <p className={styles.note} style={{ left: pct(streamStart.x + 12), top: pct(streamStart.y - 18) }}>
          Normal traffic streaming in
        </p>
      </motion.div>

      <motion.p
        className={`${styles.note} ${styles.hotNote}`}
        style={{ opacity: hot, right: pct(760 - EVENT_AT.x + 26), top: pct(EVENT_AT.y - 20) }}
      >
        <span>
          34 accounts tried
          <br />
          from one address
        </span>
        <i aria-hidden="true" />
      </motion.p>

      {/* what each engine saw, in a few words */}
      <div className={styles.tags} style={{ left: pct(EVENT_AT.x + 28), top: pct(EVENT_AT.y - 22) }}>
        <motion.div className={styles.tagRow} style={{ opacity: ruleTag }}>
          <SourceTag source="rule" label="RULE CS-1" className={styles.tag} />
          <span>Matches a known attack</span>
        </motion.div>
        <motion.div className={styles.tagRow} style={{ opacity: aiTag }}>
          <SourceTag source="ai" label="AI ENGINE 0.81" className={styles.tag} />
          <span>Unusual for this login page</span>
        </motion.div>
      </div>
    </div>
  );
}
