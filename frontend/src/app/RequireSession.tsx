import { Navigate, Outlet, useLocation } from "react-router-dom";
import { loginRequired } from "../data/source";
import { useSession } from "../store/useSession";

/** On the real backend, every page needs a signed-in analyst; afterwards the sign-in page brings you back. */
export function RequireSession() {
  const session = useSession((s) => s.session);
  const { pathname, search, hash } = useLocation();
  if (!loginRequired || session) return <Outlet />;
  return <Navigate to={`/login?next=${encodeURIComponent(pathname + search + hash)}`} replace />;
}
