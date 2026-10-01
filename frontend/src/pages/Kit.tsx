// TEMPORARY design review page (/kit). Every component in every state, on the pixel field.
// Delete this file and its route once the dashboard is built.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ReactEChartsCore from "echarts-for-react/esm/core";
import type { AttackType, DetectedBy, Fix, Incident, Severity } from "../data/types";
import { FixCard } from "../components/FixCard";
import { MitigationsCard } from "../features/fixes/Fixes";
import { assessRisk, rankIncidents, TIER_ORDER } from "../lib/rank";
import { chartColors, chartTheme, echarts } from "../lib/echartsTheme";
import { remainingShare } from "../lib/heat";
import { FAMILIES, FAMILY_CENTRE } from "../lib/family";
import { AttentionGauge } from "../components/AttentionGauge";
import { Button } from "../components/Button";
import { Chip, SplitChip } from "../components/Chip";
import { CountdownRing } from "../components/CountdownRing";
import { GlassCard } from "../components/GlassCard";
import { HeatSegments } from "../components/HeatSegments";
import { NumText } from "../components/NumText";
import { BoxTitle, Panel } from "../components/Panel";
import { QueueRow } from "../components/QueueRow";
import { RiskReadout } from "../components/RiskReadout";
import { ScanlineOverlay } from "../components/ScanlineOverlay";
import { SevBars } from "../components/SevBars";
import { SourceTag } from "../components/SourceTag";
import { TierEmpty, TierHeader } from "../components/TierHeader";
import { useNetra, useRankedIncidents } from "../store/useNetra";
import styles from "./Kit.module.css";

interface Sample {
  id: string;
  name: string;
  attackType: AttackType;
  mitre: string;
  severity: Severity;
  attentionScore: number;
  detectedBy: DetectedBy;
  windowMin: number;
  startedMinAgo: number;
}

// Illustrative incidents. Their windows loop in the kit so every heat state keeps appearing.
const SAMPLES: Sample[] = [
  { id: "0142", name: "Credential stuffing, account taken over", attackType: "account_takeover", mitre: "T1110.004", severity: 5, attentionScore: 100, detectedBy: "both", windowMin: 10, startedMinAgo: 5.13 },
  { id: "0139", name: "HTTP flood", attackType: "http_flood", mitre: "T1499.002", severity: 4, attentionScore: 70, detectedBy: "rule", windowMin: 3, startedMinAgo: 2.62 },
  { id: "0140", name: "Data exfiltration", attackType: "data_exfiltration", mitre: "T1567", severity: 5, attentionScore: 45, detectedBy: "ai", windowMin: 10, startedMinAgo: 5 },
  { id: "0137", name: "Brute force", attackType: "brute_force", mitre: "T1110.001", severity: 3, attentionScore: 60, detectedBy: "rule", windowMin: 10, startedMinAgo: 7 },
  { id: "0141", name: "Admin abuse", attackType: "admin_abuse", mitre: "T1078.003", severity: 5, attentionScore: 55, detectedBy: "rule", windowMin: 5, startedMinAgo: 1 },
  { id: "0136", name: "Web scan and probing", attackType: "web_scan", mitre: "T1595.003", severity: 2, attentionScore: 40, detectedBy: "rule", windowMin: 15, startedMinAgo: 7.5 },
  { id: "0138", name: "Web scan and probing", attackType: "web_scan", mitre: "T1595.003", severity: 2, attentionScore: 25, detectedBy: "ai", windowMin: 15, startedMinAgo: 2 },
];

const WORKED = [
  { name: "Credential stuffing, account taken over", sev: 5, attn: 100, remaining: 1.0, risk: "0.50", tier: "ACT NOW" },
  { name: "HTTP flood, just started", sev: 4, attn: 70, remaining: 0.9, risk: "0.31", tier: "ACT SOON" },
  { name: "Same flood, 80% of its window gone", sev: 4, attn: 70, remaining: 0.2, risk: "0.50", tier: "ACT NOW" },
  { name: "Data exfiltration, thin evidence", sev: 5, attn: 45, remaining: 0.5, risk: "0.34", tier: "ACT SOON" },
  { name: "Brute force", sev: 3, attn: 60, remaining: 0.3, risk: "0.31", tier: "ACT SOON" },
  { name: "Web scan", sev: 2, attn: 40, remaining: 0.5, risk: "0.12", tier: "WATCH" },
];

const SAMPLE_FIX: Fix = {
  actionId: "enable_mfa",
  name: "Enable MFA",
  d3fend: { id: null, name: "Multi-factor Authentication" },
  confidence: 0.88,
  rank: 1,
  reasons: [
    { feature: "unique_users_ip_5m", sentence: "One address tried 34 different accounts", value: 34, contribution: 0.29 },
    // Negative contribution shown as an outlined bar (kit sample only).
    { feature: "hour_of_day", sentence: "Attempts during normal working hours", value: 14, contribution: -0.04 },
  ],
};

const SAMPLE_INCIDENT: Incident = {
  id: "0142",
  attackType: "credential_stuffing",
  name: "Credential stuffing",
  mitre: { id: "T1110.004", name: "Credential Stuffing", tactic: "Credential Access" },
  severity: 4,
  attentionScore: 60,
  detectedBy: "rule",
  createdAt: new Date().toISOString(),
  staleBy: new Date(Date.now() + 600_000).toISOString(),
  status: "open",
  entities: { users: [], ips: [], hosts: [] },
  signals: [],
  fixes: [],
  fallback: {
    technique: "T1110",
    mitigations: [
      { id: "M1032", name: "Multi-factor Authentication" },
      { id: "M1036", name: "Account Use Policies" },
      { id: "M1027", name: "Password Policies" },
    ],
  },
};

const SWATCHES = [
  ["--rust", "brand, selection, ACT NOW"],
  ["--heat-1", "more than 66% left"],
  ["--heat-2", "33 to 66% left"],
  ["--heat-3", "15 to 33% left"],
  ["--heat-4", "going cold"],
  ["--stale", "expired"],
  ["--rule", "a rule found it"],
  ["--ai", "an ML model found it"],
  ["--ok", "healthy, approve"],
  ["--fail", "our pipeline failing"],
  ["--text-hi", "headings"],
  ["--text", "body"],
  ["--muted", "labels"],
] as const;

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function Section({ title, note, wide, children }: { title: string; note?: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`${styles.section} ${wide ? styles.wide : ""}`}>
      <div className={styles.sectionHead}>
        <BoxTitle>{title}</BoxTitle>
        {note && <p className={styles.note}>{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <span className={styles.caption}>{children}</span>;
}

export default function Kit() {
  const [params] = useSearchParams();
  const surface = params.get("surface") === "original" ? "original" : "console";
  const [scanlines, setScanlines] = useState(false);
  const mountedAt = useRef(Date.now()).current;
  const now = useNow();
  const [selectedId, setSelectedId] = useState("0142");

  // Each sample loops through its window, so the queue keeps changing.
  const incidents = useMemo(
    () =>
      SAMPLES.map((s) => {
        const windowMs = s.windowMin * 60_000;
        const elapsed = (s.startedMinAgo * 60_000 + (now - mountedAt)) % windowMs;
        const created = now - elapsed;
        return { ...s, createdAt: new Date(created).toISOString(), staleBy: new Date(created + windowMs).toISOString() };
      }),
    [now, mountedAt],
  );
  const ranked = rankIncidents(incidents, now);
  const focus = ranked.find((i) => i.id === selectedId) ?? ranked[0];

  const ringDeadline = (share: number, windowMin: number) => {
    const windowMs = windowMin * 60_000;
    const created = now - (1 - share) * windowMs;
    return { remaining: share, timeLeftMs: share * windowMs, staleBy: new Date(created + windowMs).toISOString() };
  };

  return (
    <div className={styles.kit}>
      {scanlines && <ScanlineOverlay strength={0.08} />}

      <header className={styles.top}>
        <div>
          <h1 className={styles.title}>Design kit</h1>
          <p className={styles.sub}>Every dashboard component in every state. Temporary page for review.</p>
          <EngineDebug />
        </div>
        <div className={styles.controls}>
          <span className={styles.caption}>THEME</span>
          <Link className={surface === "console" ? styles.on : styles.off} to="/kit">
            CONSOLE
          </Link>
          <Link className={surface === "original" ? styles.on : styles.off} to="/kit?surface=original">
            ORIGINAL
          </Link>
          <span className={styles.caption}>SCANLINES</span>
          <button type="button" className={scanlines ? styles.on : styles.off} onClick={() => setScanlines((v) => !v)}>
            {scanlines ? "ON" : "OFF"}
          </button>
        </div>
      </header>

      <div className={styles.grid}>
        <Section title="Queue" note="Live: sample windows loop, so rows drain, go cold and re-rank. Click a row to select it.">
          <Panel title="Needs attention" meta="RANKED BY RISK" corners={["tl", "br"]} className={styles.queue}>
            {TIER_ORDER.map((tier) => {
              const rows = ranked.filter((i) => i.rank.tier === tier);
              return (
                <div key={tier}>
                  <TierHeader tier={tier} count={rows.length} />
                  {rows.length === 0 && <TierEmpty />}
                  {rows.map((i) => (
                    <QueueRow
                      key={i.id}
                      score={i.attentionScore}
                      name={i.name}
                      detectedBy={i.detectedBy}
                      mitreId={i.mitre}
                      remaining={i.rank.remaining}
                      timeLeftMs={i.rank.timeLeftMs}
                      selected={i.id === focus.id}
                      dimmed={tier === "WATCH"}
                      onSelect={() => setSelectedId(i.id)}
                    />
                  ))}
                </div>
              );
            })}
          </Panel>
          <div className={styles.queue}>
            <Caption>AN EMPTY TIER</Caption>
            <TierHeader tier="ACT NOW" count={0} />
            <TierEmpty />
          </div>
        </Section>

        <div className={styles.stack}>
          <Section title="Incident focus" note="Glass card composed from the kit, following the selected row.">
            <GlassCard className={styles.focus}>
              <div className={styles.focusMain}>
                <BoxTitle>INCIDENT {focus.id}</BoxTitle>
                <p className={styles.incidentName}>{focus.name}</p>
                <div className={styles.row}>
                  {focus.detectedBy === "both" ? (
                    <SplitChip left="DETECTED BY RULES" right="+ AI" />
                  ) : (
                    <Chip tone={focus.detectedBy === "rule" ? "rule" : "ai"} dot>
                      {focus.detectedBy === "rule" ? "DETECTED BY RULES" : "DETECTED BY AI"}
                    </Chip>
                  )}
                  <Chip>{focus.mitre}</Chip>
                </div>
                <div className={styles.readouts}>
                  <SevBars severity={focus.severity} labelled />
                  <AttentionGauge value={focus.attentionScore} />
                  <RiskReadout severity={focus.severity} breakdown={focus.rank} />
                </div>
              </div>
              <CountdownRing remaining={focus.rank.remaining} timeLeftMs={focus.rank.timeLeftMs} staleBy={focus.staleBy} />
            </GlassCard>
          </Section>

          <Section title="Materials" note="Glass for focus and decisions. Opaque panels for data.">
            <div className={styles.materials}>
              <GlassCard className={styles.swatchCard}>
                <Caption>GLASS</Caption>
                <p className={styles.body}>Top bar, incident focus, fix cards.</p>
              </GlassCard>
              <Panel title="Panel" meta="META" corners={["tr", "bl"]}>
                <p className={styles.body}>Queue, escalation, graph, scope, charts, system.</p>
              </Panel>
            </div>
          </Section>
        </div>

        <Section title="Time left" note="Heat colour = share of the window left. Rings at 184px as on the dashboard." wide>
          <div className={styles.rings}>
            {[
              [0.97, "HOT"],
              [0.5, "WARM"],
              [0.25, "COOL"],
              [0.1, "GOING COLD"],
              [0, "STALE"],
            ].map(([share, label]) => {
              const d = ringDeadline(share as number, 10);
              return (
                <div key={label} className={styles.cell}>
                  <CountdownRing {...d} />
                  <Caption>{label}</Caption>
                </div>
              );
            })}
          </div>
          <div className={styles.segRows}>
            {[1, 0.8, 0.5, 0.25, 0.1, 0].map((r) => (
              <div key={r} className={styles.segRow}>
                <HeatSegments remaining={r} />
                <Caption>{Math.round(r * 100)}% LEFT</Caption>
              </div>
            ))}
            <div className={`${styles.segRow} ${styles.rustSample}`}>
              <HeatSegments remaining={0.6} onRust />
              <Caption>ON SELECTED ROW</Caption>
            </div>
          </div>
        </Section>

        <Section title="Readouts" note="Three numbers, three questions: how bad, how sure, how soon.">
          <div className={styles.readoutGrid}>
            <div className={styles.cellRow}>
              {[1, 2, 3, 4, 5].map((s) => (
                <SevBars key={s} severity={s} />
              ))}
            </div>
            <div className={styles.cellRow}>
              {[20, 60, 100].map((v) => (
                <AttentionGauge key={v} value={v} />
              ))}
            </div>
            <div className={styles.cellCol}>
              {WORKED.filter((_, i) => i === 0 || i === 1 || i === 5).map((w) => (
                <RiskReadout key={w.name} severity={w.sev} breakdown={assessRisk(w.sev, w.attn, w.remaining)} />
              ))}
            </div>
          </div>
        </Section>

        <Section title="Numbers" note="IBM Plex Mono for every numeral. Swap the face in one place: --font-num.">
          <div className={styles.cellRow}>
            <NumText value="15" size="s" />
            <NumText value="70" size="m" />
            <NumText value="0.52" size="l" />
            <NumText value="04:52" size="xl" />
            <NumText value="14:32:07" size="m" />
          </div>
        </Section>

        <Section title="Tags, chips, buttons">
          <div className={styles.cellCol}>
            <div className={styles.row}>
              <SourceTag source="rule" />
              <SourceTag source="ai" />
              <SourceTag source="rule" label="CS-1" />
              <SourceTag source="ai" label="ATDE" />
            </div>
            <div className={styles.row}>
              <Chip tone="rust" solid>ACT NOW</Chip>
              <Chip tone="soon">ACT SOON</Chip>
              <Chip tone="watch">WATCH</Chip>
              <Chip>EXPIRED 3</Chip>
              <Chip tone="ok">JUDGED NORMAL 1</Chip>
              <Chip tone="muted" dashed>SIMULATED FEED</Chip>
            </div>
            <div className={styles.row}>
              <Chip tone="rule" dot>DETECTED BY RULES</Chip>
              <Chip tone="ai" dot>DETECTED BY AI</Chip>
              <SplitChip left="DETECTED BY RULES" right="+ AI" />
              <Chip>maria.silva</Chip>
              <Chip tone="fail">FEED DOWN</Chip>
            </div>
            <div className={styles.row}>
              <Button variant="approve">APPROVE FIX</Button>
              <Button variant="reject">REJECT</Button>
              <Button variant="primary">OPEN LIVE DASHBOARD</Button>
              <Button variant="approve" disabled>APPROVE FIX</Button>
            </div>
          </div>
        </Section>

        <Section title="Ranking" note="src/lib/rank.ts against the worked examples in DATA_CONTRACT.md." wide>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>INCIDENT</th>
                <th>SEV</th>
                <th>ATTENTION</th>
                <th>LEFT</th>
                <th>RISK</th>
                <th>TIER</th>
                <th>EXPECTED</th>
                <th>CHECK</th>
              </tr>
            </thead>
            <tbody>
              {WORKED.map((w) => {
                const r = assessRisk(w.sev, w.attn, w.remaining);
                const pass = r.risk.toFixed(2) === w.risk && r.tier === w.tier;
                return (
                  <tr key={w.name}>
                    <td className={styles.human}>{w.name}</td>
                    <td>{w.sev}</td>
                    <td>{w.attn}</td>
                    <td>{w.remaining.toFixed(1)}</td>
                    <td>{r.risk.toFixed(2)}</td>
                    <td>{r.tier}</td>
                    <td>
                      {w.risk} {w.tier}
                    </td>
                    <td style={{ color: pass ? "var(--ok)" : "var(--fail)" }}>{pass ? "PASS" : "FAIL"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        <Section title="Fixes" note="Default, approved, locked (another fix approved); then the two MITRE fallbacks." wide>
          <div className={styles.fixRow}>
            <FixCard fix={SAMPLE_FIX} onApprove={() => {}} onReject={() => {}} />
            <FixCard fix={{ ...SAMPLE_FIX, rank: 2, name: "Revoke active sessions", confidence: 0.83 }} approvedAt={now} onApprove={() => {}} onReject={() => {}} />
            <FixCard fix={{ ...SAMPLE_FIX, rank: 3, name: "Reset credentials", confidence: 0.79, d3fend: { id: null, name: "" } }} locked onApprove={() => {}} onReject={() => {}} />
          </div>
          <div className={styles.fixRow2}>
            <MitigationsCard incident={SAMPLE_INCIDENT} />
            <MitigationsCard incident={SAMPLE_INCIDENT} crie={{ name: "CRIE", version: "0.0.0", trainedAt: null, status: "pending" }} />
          </div>
        </Section>

        <Section title="Chart theme" note="ECharts with our theme: rules violet under AI cyan, rust marker.">
          <Panel title="Detections / min" meta="LAST 30 MIN">
            <DemoChart surface={surface} />
          </Panel>
        </Section>

        <Section title="Colour roles" note="Every colour has one job.">
          <div className={styles.swatches}>
            {SWATCHES.map(([v, job]) => (
              <div key={v} className={styles.swatch}>
                <i style={{ background: `var(${v})` }} />
                <span className={styles.caption}>{v}</span>
                <span className={styles.body}>{job}</span>
              </div>
            ))}
          </div>
          <p className={styles.note}>
            Scope sectors: {FAMILIES.map((f) => `${f} ${FAMILY_CENTRE[f]}°`).join(", ")}. Sample remaining for 0142:{" "}
            {remainingShare(incidents[0].createdAt, incidents[0].staleBy, now).toFixed(2)}
          </p>
        </Section>
      </div>
    </div>
  );
}

/** One line proving the data engine is running. */
function EngineDebug() {
  const ranked = useRankedIncidents();
  const expired = useNetra((s) => s.expired.length);
  const judgedNormal = useNetra((s) => s.health?.judgedNormalToday ?? 0);
  const health = useNetra((s) => s.health);
  const tiers = TIER_ORDER.map((t) => `${t} ${ranked.filter((i) => i.rank.tier === t).length}`).join(" / ");
  return (
    <p className={styles.debug}>
      ENGINE: {ranked.length} OPEN ({tiers}) · {expired} EXPIRED · {judgedNormal} JUDGED NORMAL ·{" "}
      {health ? `${health.eventsPerSec} EVENTS/S · P95 ${(health.freshnessMs.p95 / 1000).toFixed(1)}S` : "NO HEALTH YET"}
    </p>
  );
}

function DemoChart({ surface }: { surface: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<ReturnType<typeof chartTheme> | null>(null);
  const [rust, setRust] = useState("");

  useEffect(() => {
    if (!ref.current) return;
    setTheme(chartTheme(ref.current));
    setRust(chartColors(ref.current).rust);
  }, [surface]);

  const option = useMemo(() => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const labels = Array.from({ length: 30 }, (_, i) => (i === 29 ? "NOW" : `-${29 - i}`));
    const rule = labels.map((_, i) => (i >= 22 ? 6 + Math.round(rnd() * 3) : 1 + Math.round(rnd() * 3)));
    const ai = labels.map((_, i) => (i >= 22 ? 2 + Math.round(rnd() * 2) : Math.round(rnd() * 2)));
    return {
      grid: { left: 26, right: 8, top: 18, bottom: 22 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: labels, axisLabel: { interval: 4 } },
      yAxis: { type: "value", minInterval: 1 },
      series: [
        {
          name: "Rules",
          type: "bar",
          stack: "d",
          barWidth: "62%",
          data: rule,
          markLine: {
            data: [{ xAxis: "-7" }],
            lineStyle: { color: rust },
            label: { formatter: "ATTACK STARTS", color: rust, position: "end" },
          },
        },
        { name: "AI engine", type: "bar", stack: "d", barWidth: "62%", data: ai },
      ],
    };
  }, [rust]);

  return (
    <div ref={ref} style={{ height: 170 }}>
      {theme && (
        <ReactEChartsCore
          key={surface}
          echarts={echarts}
          theme={theme}
          option={option}
          style={{ height: 170 }}
          opts={{ renderer: "canvas" }}
        />
      )}
    </div>
  );
}
