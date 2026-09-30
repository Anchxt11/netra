import { Link, NavLink } from "react-router-dom";
import styles from "./TopBar.module.css";

const NAV = [
  { to: "/live", label: "DASHBOARD", end: true },
  { to: "/engines", label: "ENGINES", end: false },
  { to: "/", label: "KNOW MORE", end: true },
];

export function TopBar() {
  return (
    <header className={styles.bar}>
      <div className={styles.side} />

      <div className={styles.centre}>
        <Link to="/" className={styles.logo} aria-label="NETRA home">
          <img src="/brand/netra-wordmark-cropped.svg" alt="NETRA" />
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

      {/* Status strip: filled by the OSD once the data layer exists. */}
      <div className={`${styles.side} ${styles.status}`} />
    </header>
  );
}
