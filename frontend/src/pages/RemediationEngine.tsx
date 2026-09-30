// /engines/remediation: the CRIE walkthrough. Until the ML team's export lands in
// src/data/fixtures/crie_samples.json (with "source": "model-export"), this shows an honest standby.
import crie from "../data/fixtures/crie_samples.json";
import { EngineStandby } from "../features/engines/EngineStandby";

const pctFmt = (v: number) => `${Math.round(v * 100)}%`;

export function RemediationEngine() {
  return (
    <EngineStandby
      title="Remediation engine"
      subtitle="How NETRA chooses a fix, and why it never invents one."
      source={crie.source}
      model={crie.model}
      metrics={[
        { label: "PRECISION@3", value: crie.metrics.precisionAt3, format: pctFmt },
        { label: "ANALYST ACCEPTANCE", value: crie.metrics.acceptanceRate, format: pctFmt },
      ]}
      stages={[
        "An incident is confirmed",
        "One model per fix, from a fixed list of 14",
        "The top 3 go to an analyst",
        "Why this fix: what pushed the score up",
        "When nothing is confident: MITRE's standard mitigations",
        "Every decision teaches it",
      ]}
      note="Every fix comes from a fixed, vetted list. No generative model makes decisions."
    />
  );
}
