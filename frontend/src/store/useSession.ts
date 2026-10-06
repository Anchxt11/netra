// Who is signed in to the backend. Only used when the dashboard runs on the real backend
// (VITE_DATA_SOURCE=ws): the simulated feed needs no login.
import { create } from "zustand";
import type { SessionUser } from "../data/backend/types";

export interface Session {
  token: string;
  expiresAt: number; // ms
  user: SessionUser;
}

// Per tab, and gone when the tab closes: a shared demo laptop should not stay signed in.
const KEY = "netra.session";

function load(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Session | null;
    return s && s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}

function save(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Private mode: the session lasts until the page reloads.
  }
}

interface SessionState {
  session: Session | null;
  /** Why the analyst was signed out, shown once on the sign-in page. */
  notice: string | null;
  signIn: (session: Session) => void;
  signOut: (notice?: string) => void;
}

export const useSession = create<SessionState>()((set) => ({
  session: load(),
  notice: null,
  signIn: (session) => {
    save(session);
    set({ session, notice: null });
  },
  signOut: (notice) => {
    save(null);
    set({ session: null, notice: notice ?? null });
  },
}));

export const SESSION_ENDED = "Your session ended. Sign in again.";

// The backend's tokens expire (60 minutes by default): sign out at that moment, not on the next failure.
let expiry = 0;
function arm(s: Session | null) {
  window.clearTimeout(expiry);
  if (s) expiry = window.setTimeout(() => useSession.getState().signOut(SESSION_ENDED), Math.max(0, s.expiresAt - Date.now()));
}
arm(useSession.getState().session);
useSession.subscribe((s, prev) => {
  if (s.session !== prev.session) arm(s.session);
});
