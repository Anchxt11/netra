// Normal traffic for the simulated feed's live monitor: the everyday requests around the attacks.
import type { AttackType, FeedEvent } from "./types";
import type { Rng } from "./rng";
import { HOSTS, USERS, randomIp, type Ctx } from "./catalog";

const PATHS = ["/", "/products/41", "/products/208", "/search?q=lamp", "/search?q=desk", "/account", "/cart", "/static/app.js", "/img/p12.jpg", "/api/orders?page=2", "/contact"];

let seq = 0;
const id = () => `f${(seq++).toString(36)}`;

/** One ordinary request or login, as the feed shows it. */
export function normalEvent(r: Rng, ts: number): FeedEvent {
  const roll = r.int(0, 9);
  const what =
    roll === 0
      ? `login ok for ${r.pick([...USERS])}`
      : roll === 1
        ? `POST /cart · 201`
        : `GET ${r.pick(PATHS)} · ${r.chance(0.04) ? 404 : 200}`;
  return { id: id(), ts: new Date(ts).toISOString(), ip: randomIp(r), what };
}

/** What a flagged event of each attack looks like in the feed, from the incident's own story. */
export function attackEvent(type: AttackType, ctx: Ctx, ruleId: string, ts: number): FeedEvent {
  const what: Record<AttackType, string> = {
    brute_force: `POST /login · 401 for ${ctx.user}`,
    credential_stuffing: "POST /login · 401",
    account_takeover: `login ok for ${ctx.user} from a new address`,
    web_scan: `GET ${ctx.path} · 404`,
    data_exfiltration: "GET /export?type=customers · 200",
    admin_abuse: `${ctx.user} ran ${ctx.command}`,
    http_flood: `GET / · 503 on ${HOSTS[0]}`,
    unusual_activity: "unusual network flow",
  };
  const ai = ruleId.startsWith("ATDE");
  return {
    id: id(),
    ts: new Date(ts).toISOString(),
    ip: type === "credential_stuffing" || type === "http_flood" ? ctx.ips[0] ?? ctx.ip : ctx.ip,
    what: what[type],
    flag: { by: ai ? "ai" : "rule", label: ai ? "AI" : ruleId },
  };
}
