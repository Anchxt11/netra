// The first-visit tour: a spotlight walks through the dashboard, one box at a time, saying in
// plain words what each one is for. Plays once (remembered in this browser), never in demo mode,
// and can be replayed from the Tour button in the header. Esc skips, arrow keys move.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useNetra } from "../../store/useNetra";
import styles from "./Tour.module.css";

interface TourStep {
  target: string; // matches data-tour="..." on the box
  title: string;
  text: string;
}

const STEPS: TourStep[] = [
  {
    target: "queue",
    title: "Needs attention",
    text: "Every open incident, ranked by risk: how bad, how sure and how soon. The dot cools from ember to ash as time runs out.",
  },
  {
    target: "focus",
    title: "The incident you picked",
    text: "What it is, who is involved, and the countdown before its evidence goes cold.",
  },
  {
    target: "escalation",
    title: "How it escalated",
    text: "Attention climbs one step per warning sign. Hover a step for the full sentence; lilac steps came from the AI engine.",
  },
  {
    target: "fixes",
    title: "Fix",
    text: "Hover to see the top 3 fixes, click to open them with their reasons. Nothing runs until you approve.",
  },
  {
    target: "feed",
    title: "Live feed",
    text: "All traffic, normal included, second by second. Rust and lilac are what the rules and the AI flagged.",
  },
  {
    target: "kpis",
    title: "Live KPIs",
    text: "Five numbers from all traffic over the last minute. Each turns to warning or critical at its line; two readings in a row raise an alert.",
  },
  {
    target: "scope",
    title: "Threat scope",
    text: "All open incidents at a glance. Hover any tile to open it; the closer a dot is to the centre, the less time is left.",
  },
  {
    target: "involved",
    title: "Who is involved",
    text: "The addresses, accounts and servers in this attack, and how they connect.",
  },
  {
    target: "detections",
    title: "Detections per minute",
    text: "How many warning signs the rules and the AI engine raised, minute by minute.",
  },
  {
    target: "system",
    title: "System",
    text: "Whether NETRA itself is healthy. If the feed or a model fails, it shows here in red.",
  },
  {
    target: "status",
    title: "Live status",
    text: "The feed's heartbeat, the time, and how fresh the data on screen is. The target is under 5 seconds.",
  },
];

const KEY = "netra.toured";
const PAD = 8;
const CARD_W = 320;
const GAP = 14;

const seen = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};
const markSeen = () => {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // Private mode: the tour may simply play again next visit.
  }
};

/** Mount once on a page that shows the dashboard. `autoStart`: play on a first visit. */
export function Tour({ autoStart }: { autoStart: boolean }) {
  const open = useNetra((s) => s.tourOpen);
  const setOpen = useNetra((s) => s.setTourOpen);
  const booting = useNetra((s) => s.booting);
  const [params] = useSearchParams();
  const demo = params.get("demo") === "1";
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = STEPS[index];

  // First visit: wait for the boot screen and for the boxes to appear, then start.
  useEffect(() => {
    if (!autoStart || demo || booting || seen()) return;
    const t = window.setTimeout(() => {
      if (!seen() && document.querySelector('[data-tour="queue"]')) {
        setIndex(0);
        setOpen(true);
      }
    }, 900);
    return () => window.clearTimeout(t);
  }, [autoStart, demo, booting, setOpen]);

  const close = useCallback(() => {
    markSeen();
    setOpen(false);
    setIndex(0);
  }, [setOpen]);

  // Follow the highlighted box while the page moves or the window changes size.
  useLayoutEffect(() => {
    if (!open) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 70 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "center", behavior: "smooth" });
    let raf = 0;
    const track = () => {
      const now = el.getBoundingClientRect();
      setRect((prev) =>
        prev && prev.top === now.top && prev.left === now.left && prev.width === now.width && prev.height === now.height ? prev : now,
      );
      raf = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(raf);
  }, [open, step.target]);

  useEffect(() => {
    if (open) nextRef.current?.focus();
  }, [open, index]);

  const next = useCallback(() => (index === STEPS.length - 1 ? close() : setIndex(index + 1)), [index, close]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, next, back]);

  if (!open || !rect) return null;

  // Place the card beside the box: right if there is room, else left, else below.
  const spot = { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = spot.left + spot.width + GAP;
  let top = spot.top;
  if (left + CARD_W > vw - 12) left = spot.left - GAP - CARD_W;
  if (left < 12) {
    left = Math.min(Math.max(12, spot.left), vw - CARD_W - 12);
    top = spot.top + spot.height + GAP;
  }
  top = Math.min(Math.max(80, top), vh - 220);

  return (
    <div className={styles.tour} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
      <div className={styles.spot} style={spot} aria-hidden="true" />
      <div className={styles.card} style={{ left, top, width: CARD_W }}>
        <span className={styles.count}>
          Step {index + 1} of {STEPS.length}
        </span>
        <h2 id="tour-title" className={styles.title}>
          {step.title}
        </h2>
        <p id="tour-text" className={styles.text}>
          {step.text}
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.skip} onClick={close}>
            Skip tour
          </button>
          {index > 0 && (
            <button type="button" className={styles.back} onClick={back}>
              Back
            </button>
          )}
          <button ref={nextRef} type="button" className={styles.next} onClick={next}>
            {index === STEPS.length - 1 ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
