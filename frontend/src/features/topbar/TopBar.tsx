import { Link, NavLink } from "react-router-dom";
import { Chip } from "../../components/Chip";
import { useNetra } from "../../store/useNetra";
import styles from "./TopBar.module.css";

const NAV = [
  { to: "/live", label: "DASHBOARD", end: true },
  { to: "/engines", label: "ENGINES", end: false },
  { to: "/", label: "KNOW MORE", end: true },
];

export function TopBar() {
  const simulated = useNetra((s) => s.simulated);

  return (
    <header className={styles.row}>
      <div className={styles.side} />

      {/* The glass bar only wraps the logo and the three links. */}
      <div className={styles.bar}>
        <Link to="/" className={styles.logo} aria-label="NETRA home">
          <span className={styles.mark} aria-hidden="true" />
        </Link>
        <nav aria-label="Main">
          <ul className={styles.nav}>
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {/* Status strip: the live indicator, clock and freshness join this later. */}
      <div className={`${styles.side} ${styles.status}`}>
        {simulated && (
          <Chip tone="muted" dashed>
            SIMULATED FEED
          </Chip>
        )}
      </div>
    </header>
  );
}
