import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { OsdChips, OsdStatus, SimulatedChip } from "./Osd";
import styles from "./TopBar.module.css";

const NAV = [
  { to: "/live", label: "DASHBOARD", end: true },
  { to: "/engines", label: "ENGINES", end: false },
  { to: "/", label: "KNOW MORE", end: true },
];

export function TopBar() {
  // The landing page stays minimal: no status readouts there.
  const landing = useLocation().pathname === "/";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`${styles.row} ${scrolled ? styles.scrolled : ""}`}>
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

      <div className={styles.side}>{landing ? <SimulatedChip /> : <OsdChips />}</div>
    </header>
  );
}
