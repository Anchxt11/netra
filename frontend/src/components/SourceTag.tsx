import styles from "./SourceTag.module.css";

interface Props {
  source: "rule" | "ai";
  /** Defaults to RULE or AI. The escalation list passes the rule ID ("CS-1") or "ATDE". */
  label?: string;
  className?: string;
}

/** Who found it: violet = a rule, cyan = an ML model. */
export function SourceTag({ source, label, className }: Props) {
  return (
    <span className={`${styles.tag} ${styles[source]} ${className ?? ""}`}>{label ?? (source === "rule" ? "RULE" : "AI")}</span>
  );
}
