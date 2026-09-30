import { Link } from "react-router-dom";
import styles from "./Landing.module.css";

// Default export so the router can lazy-load it.
export default function Landing() {
  return (
    <section className={styles.hero}>
      <h1 className={styles.mark}>
        <img src="/brand/netra-wordmark-cropped.svg" alt="NETRA" />
      </h1>
      <p className={styles.line}>Security decisions while the data is still warm.</p>
      <Link to="/live" className={styles.cta}>
        OPEN LIVE DASHBOARD
      </Link>
    </section>
  );
}
