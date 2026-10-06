// Sign in to the real backend (analyst or admin account). Only reachable when VITE_DATA_SOURCE=ws:
// the simulated feed needs no login. Glass: this card is a decision, not data.
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { GlassCard } from "../components/GlassCard";
import { ApiError, createApi } from "../data/backend/api";
import { API_URL, loginRequired } from "../data/source";
import { useSession } from "../store/useSession";
import styles from "./Login.module.css";

/** Only go back to a page of this app after signing in. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/live";
}

export default function Login() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const session = useSession((s) => s.session);
  const notice = useSession((s) => s.notice);
  const signIn = useSession((s) => s.signIn);
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loginRequired) return <Navigate to="/live" replace />;
  if (session) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createApi(API_URL).login(username.trim(), password);
      signIn({ token: r.access_token, expiresAt: Date.now() + r.expires_in * 1000, user: r.user });
      navigate(next, { replace: true });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : -1;
      setError(
        status === 401
          ? "That username and password do not match."
          : status === 0
            ? `Cannot reach the server at ${API_URL}. Is the backend running?`
            : "The server could not sign you in. Try again.",
      );
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <GlassCard className={styles.card}>
        <h1 className={styles.title}>SIGN IN</h1>
        <p className={styles.lead}>Use your analyst or admin account to open the live dashboard.</p>
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        <form className={styles.form} onSubmit={submit} noValidate>
          <label className={styles.field}>
            <span className={styles.label}>USERNAME</span>
            <input
              className={styles.input}
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>PASSWORD</span>
            <input
              className={styles.input}
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <Button variant="primary" type="submit" className={styles.submit} disabled={busy || !username.trim() || !password}>
            {busy ? "SIGNING IN" : "SIGN IN"}
          </Button>
        </form>
        <p className={styles.server}>SERVER {API_URL.replace(/^https?:\/\//, "").toUpperCase()}</p>
      </GlassCard>
    </div>
  );
}
