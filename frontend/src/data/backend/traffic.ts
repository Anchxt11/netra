// The live monitor on the real backend: every event the API streams counts (normal or flagged),
// and a few of each second's events go into the feed list, flagged ones first.
import { formatBytes } from "../catalog.ts";
import type { FeedEvent, TrafficSecond } from "../types";
import { BACKEND_RULES, WATCHLIST, WATCHLIST_RULE } from "./rules.ts";
import type { EnrichedEvent } from "./types";

const SAMPLE_FLAGGED = 6;
const SAMPLE_NORMAL = 5;

const known = (v: string | undefined) => (v && v !== "-" ? v : undefined);

/** One enriched event as the feed shows it. */
export function feedEvent(ev: EnrichedEvent, flag?: FeedEvent["flag"]): FeedEvent {
  const user = known(ev.user);
  let what: string;
  switch (ev.event_type) {
    case "login":
      what = `login ${ev.status === "success" ? "ok" : "failed"}${user ? ` for ${user}` : ""}`;
      break;
    case "process_start":
      what = `${user ?? "someone"} ran ${ev.process ?? "a process"}`;
      break;
    case "data_transfer":
      what = `${user ?? "someone"} sent ${formatBytes(ev.bytes_out ?? 0)}`;
      break;
    default:
      what = `${ev.method || "GET"} ${ev.path || "/"} · ${ev.http_status ?? ""}`.trim();
  }
  const hit = ev.rule_hits?.[0];
  const ruleFlag = hit ? { by: "rule" as const, label: hit === WATCHLIST_RULE ? WATCHLIST.code : (BACKEND_RULES[hit]?.code ?? hit) } : undefined;
  return { id: ev.event_id, ts: ev.event_ts, ip: ev.ip ?? "unknown", what, flag: flag ?? ruleFlag };
}

export class TrafficMeter {
  private normal = 0;
  private rule = 0;
  private ai = 0;
  private flagged: FeedEvent[] = [];
  private plain: FeedEvent[] = [];

  /** A batch from the WebSocket. `dropped` are events the server counted but did not send. */
  addEvents(batch: EnrichedEvent[], dropped = 0) {
    for (const ev of batch) {
      if (ev.rule_hits?.length) {
        this.rule += 1;
        if (this.flagged.length < SAMPLE_FLAGGED) this.flagged.push(feedEvent(ev));
      } else {
        this.normal += 1;
        if (this.plain.length < SAMPLE_NORMAL) this.plain.push(feedEvent(ev));
      }
    }
    this.normal += dropped; // unseen, so counted as normal: the honest guess for the chart
  }

  /** A real model flagged this event. */
  addAi(ev: EnrichedEvent | undefined, score?: number) {
    this.ai += 1;
    if (ev && this.flagged.length < SAMPLE_FLAGGED) {
      this.flagged.push(feedEvent(ev, { by: "ai", label: score !== undefined ? `AI ${score.toFixed(2)}` : "AI" }));
    }
  }

  /** Once a second: this second's counts and sample, then start the next second. */
  flush(now: number): { second: TrafficSecond; events: FeedEvent[] } {
    const events = [...this.flagged, ...this.plain].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
    const second = { t: new Date(now).toISOString(), normal: this.normal, rule: this.rule, ai: this.ai };
    this.normal = this.rule = this.ai = 0;
    this.flagged = [];
    this.plain = [];
    return { second, events };
  }
}
