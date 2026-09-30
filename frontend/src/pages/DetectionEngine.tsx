// /engines/detection: the ATDE walkthrough. Until the ML team's export lands in
// src/data/fixtures/atde_samples.json (with "source": "model-export"), this shows an honest standby.
import atde from "../data/fixtures/atde_samples.json";
import { EngineStandby } from "../features/engines/EngineStandby";

const pctFmt = (v: number) => `${Math.round(v * 100)}%`;

export function DetectionEngine() {
  return (
    <EngineStandby
      title="Detection engine"
      subtitle="How NETRA catches attacks that rules miss. This walkthrough replays real output from our model."
      source={atde.source}
      model={atde.model}
      metrics={[
        { label: "PRECISION (ATTACKS)", value: atde.metrics.precisionMalicious, format: pctFmt },
        { label: "RECALL (ATTACKS)", value: atde.metrics.recallMalicious, format: pctFmt },
        { label: "SCORING TIME P95", value: atde.metrics.scoringLatencyMsP95, format: (v) => `${v} MS` },
      ]}
      stages={[
        "A live event arrives",
        `Rules check it first (${atde.rulesChecked} detection rules)`,
        "Isolation Forest: how unusual is it?",
        "XGBoost: what kind of attack?",
        "Result, checked against the answer key",
      ]}
      note="Training labels come from an automated engine, not analyst verdicts. Analyst decisions in NETRA become new training data."
    />
  );
}
