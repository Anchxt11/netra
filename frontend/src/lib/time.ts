const pad = (n: number) => String(n).padStart(2, "0");

/** 292000 -> "04:52". Rounds up so "00:00" only shows once time has truly run out. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Wall-clock "14:37:12" in the viewer's local time. */
export function formatClock(t: string | number | Date): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
