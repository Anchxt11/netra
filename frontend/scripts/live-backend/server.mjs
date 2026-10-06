// A stand-in for the backend API (api/app on the backend branch), for testing the dashboard
// without Docker. Same login, same REST routes, same WebSocket messages. The events and alerts
// are real: the backend team's simulator and rule engine run in pipeline.py.
//
//   npm run live-backend -- --backend <backend checkout> [simulator options]
//   then: npm run dev:live   (the dashboard on the real-backend code path)
//
// Test switches (not in the real API):
//   POST /_dev/stall?seconds=20   stop delivering events, like a stuck pipeline
//   POST /_dev/drop               drop every WebSocket, like a network blip
//   POST /_dev/expire             end every session (the socket closes with 4401)
//   POST /_dev/refuse-writes?seconds=30   decisions fail to save (503)
import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf("--backend");
const backend = resolve(at >= 0 ? args.splice(at, 2)[1] : process.env.NETRA_BACKEND ?? resolve(here, "../../.."));
const simArgs = args.length ? args : ["--rate", "12", "--warmup", "15", "--attack-every", "45"];
const PORT = Number(process.env.PORT ?? 8000);

// Same development defaults as api/app/settings.py.
const SECRET = "dev-secret-change-me-please-0123456789";
const TTL_S = 60 * 60;
const USERS = [
  { id: 1, username: "admin", password: "admin12345", role: "admin" },
  { id: 2, username: "analyst", password: "analyst12345", role: "analyst" },
];
const FLUSH_MS = 250;
const MAX_PER_PUSH = 200;

// ------------------------------------------------------------------ state
const events = []; // newest last, with stored_ts
const rows = []; // the incidents table: one row per alert
let buffer = [];
let stalledUntil = 0;
let refuseWritesUntil = 0;
const clients = new Set();

const now = () => new Date().toISOString();
const parseFeatures = (ev) => {
  if (typeof ev.features !== "string") return ev;
  try {
    return { ...ev, features: JSON.parse(ev.features) };
  } catch {
    return ev;
  }
};

// ------------------------------------------------------------------ the pipeline
const py = spawn(process.env.PYTHON ?? "python", [resolve(here, "pipeline.py"), backend, ...simArgs], {
  stdio: ["ignore", "pipe", "inherit"],
});
py.on("exit", (code) => {
  console.error(`pipeline stopped (${code}). Is --backend a checkout of the backend branch?`);
  process.exit(1);
});
createInterface({ input: py.stdout }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.kind === "rules") return console.log(`rules loaded: ${msg.data.join(", ")}`);
  if (Date.now() < stalledUntil) return; // a stuck pipeline delivers nothing
  if (msg.kind === "event") {
    const ev = { ...msg.data, stored_ts: now() };
    events.push(ev);
    if (events.length > 20000) events.splice(0, events.length - 20000);
    buffer.push(parseFeatures(msg.data));
  } else if (msg.kind === "alert") {
    const a = msg.data;
    const row = {
      id: rows.length + 1,
      alert_id: a.alert_id,
      rule_id: a.rule_id,
      model: a.model,
      title: a.title ?? null,
      severity: String(a.severity ?? "unknown").toLowerCase(),
      event_ids: a.event_ids ?? [],
      status: "open",
      assigned_to: null,
      notes: null,
      payload: a,
      created_ts: a.created_ts,
      updated_ts: now(),
    };
    rows.push(row);
    const { payload: _p, ...cols } = row;
    broadcast("alert", cols);
  }
});

setInterval(() => {
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  broadcast("events", batch.slice(-MAX_PER_PUSH), { dropped: Math.max(0, batch.length - MAX_PER_PUSH) });
}, FLUSH_MS);

// ------------------------------------------------------------------ tokens (HS256, like PyJWT)
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const sign = (data) => createHmac("sha256", SECRET).update(data).digest("base64url");
function createToken(u) {
  const iat = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: String(u.id), username: u.username, role: u.role, iat, exp: iat + TTL_S })}`;
  return `${body}.${sign(body)}`;
}
function decodeToken(token) {
  const [h, p, s] = String(token ?? "").split(".");
  if (!h || !p || sign(`${h}.${p}`) !== s) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  return claims.exp * 1000 > Date.now() && !revoked.has(claims.iat) ? claims : null;
}
const revoked = new Set(); // /_dev/expire

// ------------------------------------------------------------------ REST
function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "*",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const readBody = (req) =>
  new Promise((ok) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        ok(JSON.parse(data || "{}"));
      } catch {
        ok({});
      }
    });
  });
const user = (req) => decodeToken((req.headers.authorization ?? "").replace(/^Bearer /, ""));
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  if (req.method === "OPTIONS") return send(res, 204);

  if (req.method === "POST" && path === "/auth/login") {
    const { username, password } = await readBody(req);
    const u = USERS.find((x) => x.username === username && x.password === password);
    if (!u) return send(res, 401, { detail: "Invalid credentials" });
    return send(res, 200, {
      access_token: createToken(u),
      token_type: "bearer",
      expires_in: TTL_S,
      user: { id: u.id, username: u.username, role: u.role },
    });
  }
  if (path === "/health") {
    return send(res, 200, { status: "ok", postgres: true, consumers: { events: true, alerts: true }, ws_clients: clients.size });
  }
  if (path === "/freshness") {
    const window = 5 * 60_000;
    const recent = events.filter((e) => Date.now() - Date.parse(e.stored_ts) < window);
    const lags = recent.map((e) => Date.parse(e.stored_ts) - Date.parse(e.event_ts)).sort((a, b) => a - b);
    const p95 = quantile(lags, 0.95);
    const last = recent.length ? (Date.now() - Date.parse(recent.at(-1).stored_ts)) / 1000 : null;
    const status = !recent.length ? "no_data" : last > 10 ? "stalled" : p95 / 1000 > 5 ? "breach" : "ok";
    return send(res, 200, {
      window_minutes: 5,
      events: recent.length,
      avg_events_per_sec: +(recent.length / 300).toFixed(2),
      p50_seconds: lags.length ? quantile(lags, 0.5) / 1000 : null,
      p95_seconds: p95 === null ? null : p95 / 1000,
      max_seconds: lags.length ? lags.at(-1) / 1000 : null,
      sla_p95_seconds: 5,
      seconds_since_last_event: last === null ? null : +last.toFixed(2),
      status,
      computed_at: now(),
    });
  }
  if (path.startsWith("/_dev/") && req.method === "POST") {
    if (path === "/_dev/stall") stalledUntil = Date.now() + Number(url.searchParams.get("seconds") ?? 20) * 1000;
    if (path === "/_dev/refuse-writes") refuseWritesUntil = Date.now() + Number(url.searchParams.get("seconds") ?? 30) * 1000;
    if (path === "/_dev/drop") for (const c of clients) c.close(1012, "dropped for testing");
    if (path === "/_dev/expire") {
      for (const c of clients) revoked.add(c.claims.iat), c.close(4401, "invalid or expired token");
    }
    return send(res, 200, { ok: true });
  }

  const me = user(req);
  if (!me) return send(res, 401, { detail: "Invalid or expired token" });

  if (path === "/auth/me") return send(res, 200, { id: Number(me.sub), username: me.username, role: me.role });
  if (path === "/events/recent") {
    const limit = Math.min(1000, Number(url.searchParams.get("limit") ?? 100));
    return send(res, 200, events.slice(-limit).reverse().map(parseFeatures));
  }
  if (path === "/alerts/recent" || path === "/incidents") {
    const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 50));
    return send(res, 200, rows.slice(-limit).reverse().map(({ payload: _p, ...r }) => r));
  }
  const m = path.match(/^\/incidents\/(\d+)$/);
  if (m && req.method === "PATCH" && Date.now() < refuseWritesUntil) return send(res, 503, { detail: "Database unavailable" });
  if (m && req.method === "PATCH") {
    const row = rows[Number(m[1]) - 1];
    if (!row) return send(res, 404, { detail: "Incident not found" });
    const body = await readBody(req);
    for (const k of ["status", "notes", "assigned_to"]) if (k in body) row[k] = body[k];
    row.updated_ts = now();
    const { payload: _p, ...cols } = row;
    broadcast("incident_update", cols);
    console.log(`incident ${row.id} updated: ${JSON.stringify(body)}`);
    return send(res, 200, cols);
  }
  return send(res, 404, { detail: "Not Found" });
});

// ------------------------------------------------------------------ WebSocket (RFC 6455, text frames only)
function frame(opcode, payload) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  if (n >= 126) {
    head[0] = 0x80 | opcode;
    head[1] = n < 65536 ? 126 : 127;
    if (n < 65536) head.writeUInt16BE(n, 2);
    else head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, payload]);
}

function broadcast(type, data, extra = {}) {
  const text = JSON.stringify({ type, data, server_ts: now(), ...extra });
  for (const c of clients) c.send(text);
}

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") return socket.destroy();
  const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);

  const client = {
    claims: decodeToken(url.searchParams.get("token")),
    send: (text) => socket.writable && socket.write(frame(0x1, Buffer.from(text))),
    close: (code, reason) => {
      const p = Buffer.alloc(2 + Buffer.byteLength(reason));
      p.writeUInt16BE(code, 0);
      p.write(reason, 2);
      if (socket.writable) socket.end(frame(0x8, p));
      clients.delete(client);
    },
  };
  socket.on("error", () => clients.delete(client));
  socket.on("close", () => clients.delete(client));
  if (!client.claims) return client.close(4401, "invalid or expired token"); // accept, then close: like the real API

  clients.add(client);
  client.send(JSON.stringify({ type: "hello", data: { username: client.claims.username, role: client.claims.role }, server_ts: now() }));

  let buf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) [len, off] = buf.length >= 4 ? [buf.readUInt16BE(2), 4] : [-1, 0];
      else if (len === 127) [len, off] = buf.length >= 10 ? [Number(buf.readBigUInt64BE(2)), 10] : [-1, 0];
      if (len < 0 || buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len).map((b, i) => b ^ mask[i % 4]));
      buf = buf.subarray(off + 4 + len);
      if (op === 0x8) return client.close(1000, "");
      if (op === 0x9) socket.write(frame(0xa, payload));
      if (op === 0x1 && payload.toString().trim().toLowerCase() === "ping") client.send(JSON.stringify({ type: "pong", server_ts: now() }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`stand-in API on http://localhost:${PORT} (WebSocket ws://localhost:${PORT}/ws)`);
  console.log(`backend code: ${backend}`);
  console.log(`simulator: ${simArgs.join(" ")}`);
});
