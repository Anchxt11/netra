import { Link, NavLink, useLocation } from "react-router-dom";
import { OsdChips, OsdStatus } from "./Osd";
import styles from "./TopBar.module.css";

const NAV = [
  { to: "/live", label: "DASHBOARD", end: true },
  { to: "/engines", label: "ENGINES", end: false },
  { to: "/", label: "KNOW MORE", end: true },
];

export function TopBar() {
  // The landing page stays minimal: no status readouts there.
  const landing = useLocation().pathname === "/";

  return (
    <header className={styles.row}>
      <div className={styles.side}>{!landing && <OsdStatus />}</div>

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

      <div className={styles.side}>{!landing && <OsdChips />}</div>
    </header>
  );
}
