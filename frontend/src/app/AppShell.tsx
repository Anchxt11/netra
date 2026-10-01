import { useCallback, useLayoutEffect, useState } from "react";
import { useNetra } from "../store/useNetra";
import { MotionConfig } from "motion/react";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { TopBar } from "../features/topbar/TopBar";
import { PixelField } from "../components/PixelField";
import { BootScreen } from "../components/BootScreen";
import styles from "./AppShell.module.css";

// Brightness of the pixel-dot background (0 to 1): dashboard pages, and the landing page.
const FIELD_INTENSITY = 0.55;
const LANDING_FIELD_INTENSITY = 0.6;
const BOOT_KEY = "netra.booted";

function alreadyBooted(): boolean {
  try {
    return sessionStorage.getItem(BOOT_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const landing = pathname === "/";
  // "console" = the quieter dashboard theme (src/styles/console.css). ?surface=original shows the unmuted tokens.
  const surface = landing ? "landing" : params.get("surface") === "original" ? "original" : "console";

  // The boot screen plays once per session, before the landing page or the live dashboard.
  const [booting, setBooting] = useState(() => (landing || pathname === "/live") && !alreadyBooted());
  const bootDone = useCallback(() => {
    try {
      sessionStorage.setItem(BOOT_KEY, "1");
    } catch {
      // Private mode: the boot screen may simply play again next visit.
    }
    setBooting(false);
  }, []);
  // Let the tour know when the boot screen is in the way.
  const publishBooting = useNetra((s) => s.setBooting);
  useLayoutEffect(() => publishBooting(booting), [booting, publishBooting]);

  return (
    // reducedMotion="user": motion animations switch off when the OS asks for reduced motion.
    <MotionConfig reducedMotion="user">
      <div className={styles.shell} data-surface={surface}>
        <PixelField intensity={surface === "console" ? FIELD_INTENSITY : landing ? LANDING_FIELD_INTENSITY : 1} />
        <TopBar />
        <main className={styles.page}>
          <Outlet />
        </main>
        {booting && <BootScreen onDone={bootDone} />}
      </div>
    </MotionConfig>
  );
}
