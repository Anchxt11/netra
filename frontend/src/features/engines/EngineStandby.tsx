// An engine page before the ML team's model export arrives: what the walkthrough will show,
// and an honest model card read from the fixture. Example data never shows a model version;
// missing values show PENDING. Spec: docs/PAGES.md sections 2 and 3, docs/DATA_CONTRACT.md "Fixtures".
import { Chip } from "../../components/Chip";
import { GlassCard } from "../../components/GlassCard";
import { BoxTitle, Panel } from "../../components/Panel";
import styles from "./EngineStandby.module.css";

interface Model {
  name: string;
  version: string;
  trainedAt: string | null;
  trainingData: string;
}

interface Props {
  title: string;
  subtitle: string;
  /** The fixture's top-level "source": "example" or "model-export". */
  source: string;
  model: Model;
  metrics: { label: string; value: number | null; format?: (v: number) => string }[];
  stages: string[];
  note: string;
}

// The fixture template says "confirm with ML pair" until the real description arrives.
const known = (text: string | null) => (text && !/^confirm/i.test(text) ? text : null);

export function EngineStandby({ title, subtitle, source, model, metrics, stages, note }: Props) {
  const example = source !== "model-export";
  const rows: [string, string | null][] = [
    ["Model", model.name],
    ["Version", example ? null : `v${model.version}`],
    ["Trained", example ? null : model.trainedAt],
    ["Training data", known(model.trainingData)],
    ...metrics.map((m): [string, string | null] => [m.label, m.value === null ? null : (m.format ?? String)(m.value)]),
  ];

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.sub}>{subtitle}</p>
      </header>

      <div className={styles.grid}>
        <GlassCard className={styles.walkthrough}>
          <div className={styles.cardHead}>
            <BoxTitle>Walkthrough</BoxTitle>
            <Chip tone="muted" dashed>
              Waiting for the model export
            </Chip>
          </div>
          <p className={styles.lead}>
            This page replays real output from {model.name}, one step at a time. It fills in as soon as the ML team's model export
            arrives.
          </p>
          <ol className={styles.stages}>
            {stages.map((s, i) => (
              <li key={s}>
                <span className={styles.n}>{String(i + 1).padStart(2, "0")}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </GlassCard>

        <Panel title="Model card" meta={example ? <Chip tone="muted">Example data</Chip> : undefined} corners={["tr", "bl"]} className={styles.card}>
          <dl className={styles.facts}>
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={value === null ? styles.pending : undefined}>{value ?? "PENDING"}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.note}>{note}</p>
        </Panel>
      </div>
    </section>
  );
}
