// The hero's second line: NETRA's novelties, one at a time. Each arrives ember-hot and cools to grey
// as the next one comes: the brand idea (warm data going cold) in motion. DESIGN.md v2, Motion.
import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import styles from "./CoolingWords.module.css";

export const NOVELTIES = [
  "ranks threats by time left",
  "puts rules and AI side by side",
  "explains every score",
  "waits for a person to approve",
  "proves its data is fresh",
  "turns noise into incidents",
];

const EVERY_MS = 2800;

export function CoolingWords() {
  const still = useReducedMotion() ?? false;
  const [i, setI] = useState(0);

  useEffect(() => {
    if (still) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % NOVELTIES.length), EVERY_MS);
    return () => window.clearInterval(id);
  }, [still]);

  return (
    <p className={styles.line}>
      <span className={styles.lead}>NETRA</span>{" "}
      {/* A new key remounts the word, so its cooling animation plays again. */}
      <span key={i} className={styles.word}>
        {NOVELTIES[i]}
      </span>
      <span className="visually-hidden">. NETRA {NOVELTIES.filter((_, n) => n !== i).join(", ")}.</span>
    </p>
  );
}
