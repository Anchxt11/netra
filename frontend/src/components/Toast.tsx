import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useNetra } from "../store/useNetra";
import styles from "./Toast.module.css";

const SHOW_MS = 4000;

/** One short confirmation at the bottom of the screen, e.g. after a fix is approved. */
export function Toast() {
  const toast = useNetra((s) => s.toast);
  const dismiss = useNetra((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(dismiss, SHOW_MS);
    return () => window.clearTimeout(t);
  }, [toast, dismiss]);

  return (
    <div className={styles.region} role="status" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className={`${styles.toast} ${toast.tone === "ok" ? styles.ok : ""}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2 }}
          >
            <i className={styles.dot} aria-hidden="true" />
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
