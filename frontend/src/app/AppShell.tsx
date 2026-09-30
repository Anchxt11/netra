import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { TopBar } from "../features/topbar/TopBar";
import { PixelField } from "../components/PixelField";
import styles from "./AppShell.module.css";

// Brightness of the pixel-dot background on dashboard pages (0 to 1).
const FIELD_INTENSITY = 0.55;

export function AppShell() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const landing = pathname === "/";
  // "console" = the quieter dashboard theme (src/styles/console.css). ?surface=original shows the unmuted tokens.
  const surface = landing ? "landing" : params.get("surface") === "original" ? "original" : "console";

  return (
    <div className={styles.shell} data-surface={surface}>
      {!landing && <PixelField intensity={surface === "original" ? 1 : FIELD_INTENSITY} />}
      <TopBar />
      <main className={styles.page}>
        <Outlet />
      </main>
    </div>
  );
}
