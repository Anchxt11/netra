// The live dashboard, at the end of the home page's story: the scroll ends somewhere real.
// It loads only as you approach it, uses the dashboard's quiet theme, and while it is on screen
// the header becomes the dashboard's header. /live still opens it directly.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNetra } from "../store/useNetra";
import styles from "./DashboardSection.module.css";

const LiveDashboard = lazy(() => import("../pages/LiveDashboard").then((m) => ({ default: m.LiveDashboard })));

export const DASHBOARD_ANCHOR = "dashboard";

export function DashboardSection() {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const setInView = useNetra((s) => s.setDashboardInView);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Start loading about one screen before it scrolls into view.
    const load = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "100% 0px" });
    // "In view": it fills most of the screen below the header.
    const view = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.35 });
    load.observe(el);
    view.observe(el);
    return () => {
      load.disconnect();
      view.disconnect();
      setInView(false);
    };
  }, [setInView]);

  return (
    <section ref={ref} id={DASHBOARD_ANCHOR} className={styles.section} data-surface="console" aria-label="Live dashboard">
      {near ? (
        <Suspense fallback={<div className={styles.space} />}>
          <LiveDashboard embedded />
        </Suspense>
      ) : (
        <div className={styles.space} />
      )}
    </section>
  );
}
