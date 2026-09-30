import type { Tier } from "../lib/rank";
import { Chip } from "./Chip";
import { NumText } from "./NumText";
import styles from "./TierHeader.module.css";

const TONE = { "ACT NOW": "rust", "ACT SOON": "soon", WATCH: "watch" } as const;
const CLASS = { "ACT NOW": styles.now, "ACT SOON": styles.soon, WATCH: styles.watch };

/** Tier label, count, and a rule to the panel edge. Tiers are urgency, so they never use heat colours. */
export function TierHeader({ tier, count }: { tier: Tier; count: number }) {
  return (
    <h3 className={`${styles.tier} ${CLASS[tier]}`}>
      <span className={styles.name}>{tier}</span>
      <NumText value={count} size="s" />
      <hr aria-hidden="true" />
    </h3>
  );
}

/** Shown when a tier has no incidents. */
export function TierEmpty() {
  return <p className={styles.empty}>NONE</p>;
}

/** ACT NOW is solid rust; the others are outlines. */
export function TierChip({ tier }: { tier: Tier }) {
  return (
    <Chip tone={TONE[tier]} solid={tier === "ACT NOW"}>
      {tier}
    </Chip>
  );
}
