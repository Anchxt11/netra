import { NavLink, Outlet } from "react-router-dom";
import styles from "./EnginesLayout.module.css";

export function EnginesLayout() {
  return (
    <div className={styles.wrap}>
      <nav aria-label="Engines" className={styles.tabs}>
        <NavLink to="detection" className={({ isActive }) => (isActive ? `${styles.tab} ${styles.on}` : styles.tab)}>
          DETECTION
        </NavLink>
        <NavLink to="remediation" className={({ isActive }) => (isActive ? `${styles.tab} ${styles.on}` : styles.tab)}>
          REMEDIATION
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
