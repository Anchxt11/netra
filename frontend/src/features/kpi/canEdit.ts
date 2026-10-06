import { loginRequired } from "../../data/source";
import { useSession } from "../../store/useSession";

/**
 * Who may change the KPI lines: an admin on the real backend (the API refuses anyone else).
 * The simulated feed has no accounts, and its lines only change the simulation in this tab.
 */
export function useCanEditThresholds(): boolean {
  const role = useSession((s) => s.session?.user.role);
  return !loginRequired || role === "admin";
}
