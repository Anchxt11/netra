"""Model 1 preprocessing: raw rows -> Isolation Forest feature matrix.
Mirrors src/parse_messages.py, src/parse.py (direction), src/features.py and
the notebook build_if_matrix. Input rows need: stream_name, timestamp,
event_id, message_sanitized. Rows must cover the preceding 3600 s (Cisco) /
600 s (AWS) of history for rolling features to match training."""
import ipaddress, json
from collections import Counter, defaultdict, deque
from pathlib import Path
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
WINDOWS = [60, 600, 3600]
TIE_RULE = "ordered_by_event_id"
_ROLL = [f"{n}_{w}s" for w in WINDOWS for n in ("cnt", "nports", "ndst")]
_COMMON = ["dir_inbound", "dir_outbound", "proto_tcp", "proto_udp", "proto_icmp",
           "dst_port_logfreq"]
FEATURES = {
    "aws_vpc_flow_log": ["packets", "bytes", "duration", "bytes_per_packet",
        "dst_port_wellknown", "cnt_60s", "nports_60s", "ndst_60s", "cnt_600s",
        "nports_600s", "ndst_600s"] + _COMMON,
    "cisco_asa": ["icmp_type", "icmp_code", "dst_port_wellknown", "cnt_60s",
        "nports_60s", "ndst_60s", "cnt_600s", "nports_600s", "ndst_600s",
        "cnt_3600s", "nports_3600s", "ndst_3600s"] + _COMMON,
}
INTERNAL_NETS = [ipaddress.ip_network(n) for n in
                 ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")]
AWS_COLS = ["version", "account_id", "interface_id", "srcaddr", "dstaddr",
            "srcport", "dstport", "protocol", "packets", "bytes",
            "start", "end", "action", "log_status"]
AWS_NUM = ["srcport", "dstport", "protocol", "packets", "bytes"]
CISCO_RE = (
    r'^<\d+>(?P<mtime>[A-Z][a-z]{2} +\d+ \d{4} \d{2}:\d{2}:\d{2}): '
    r'%ASA-\d+-(?P<msg_id>\d+): Deny (?P<proto>\w+) '
    r'src (?P<src_zone>[\w-]+):(?P<m_src_ip>[\d.]+)(?:/(?P<src_port>\d+))? '
    r'dst (?P<dst_zone>[\w-]+):(?P<m_dst_ip>[\d.]+)(?:/(?P<dst_port>\d+))?'
    r'(?: \(type (?P<icmp_type>\d+), code (?P<icmp_code>\d+)\))? '
    r'by access-group "(?P<acl>[^"]+)"'
)
_FREQ = None


def _freq_tables():
    global _FREQ
    if _FREQ is None:
        path = HERE / "dst_port_freq.json"
        if not path.exists():
            raise FileNotFoundError(f"{path} missing; run make_artifacts.py")
        _FREQ = json.loads(path.read_text())
    return _FREQ


def _parse_aws(msg):
    msg = msg.fillna("")
    p = msg.str.split(expand=True).reindex(columns=range(14))
    p.columns = AWS_COLS
    out = pd.DataFrame(index=msg.index)
    for c in AWS_NUM:
        out[c] = pd.to_numeric(p[c], errors="coerce")
    out["duration"] = (pd.to_numeric(p["end"], errors="coerce")
                       - pd.to_numeric(p["start"], errors="coerce"))
    out["m_src_ip"], out["m_dst_ip"] = p["srcaddr"], p["dstaddr"]
    return out


def _parse_cisco(msg):
    m = msg.fillna("").str.strip().str.extract(CISCO_RE)
    out = pd.DataFrame(index=msg.index)
    for c in ["proto", "src_zone", "dst_zone", "acl", "m_src_ip", "m_dst_ip"]:
        out[c] = m[c]
    for c in ["src_port", "dst_port", "icmp_type", "icmp_code"]:
        out[c] = pd.to_numeric(m[c], errors="coerce")
    return out


def _is_internal(ips):
    lut = {}
    for ip in ips.dropna().unique():
        try:
            a = ipaddress.ip_address(ip)
            lut[ip] = any(a in n for n in INTERNAL_NETS)
        except ValueError:
            lut[ip] = False
    return ips.map(lut).fillna(False).astype(bool)


def _direction(src_ip, dst_ip, src_zone=None, dst_zone=None):
    si, di = _is_internal(src_ip), _is_internal(dst_ip)
    d = pd.Series(np.select([(~si) & di, si & (~di), si & di],
                            ["inbound", "outbound", "internal"],
                            default="external"), index=src_ip.index)
    if src_zone is not None:                      # Cisco: zones override IP ranges
        sz = src_zone.fillna("").astype(str)
        dz = dst_zone.fillna("").astype(str)
        has = sz != ""
        d[has & (sz == "outside")] = "inbound"
        d[has & (sz != "outside") & (dz == "outside")] = "outbound"
        d[has & (sz != "outside") & (dz != "outside")] = "internal"
    return d


def parse_static(msgs, stream):
    """-> (base features + dst_port, protocol-name Series, direction Series)"""
    if stream == "aws_vpc_flow_log":
        p = _parse_aws(msgs)
        X = p[["protocol", "packets", "bytes", "duration", "m_src_ip", "m_dst_ip"]].copy()
        X["dst_port"] = p["dstport"]
        X["bytes_per_packet"] = X["bytes"] / X["packets"].clip(lower=1)
        proto = p["protocol"].map({1: "icmp", 6: "tcp", 17: "udp"})
        dirs = _direction(p["m_src_ip"], p["m_dst_ip"])
    else:
        p = _parse_cisco(msgs)
        X = p[["icmp_type", "icmp_code", "dst_port", "m_src_ip", "m_dst_ip"]].copy()
        proto = p["proto"]
        dirs = _direction(p["m_src_ip"], p["m_dst_ip"], p["src_zone"], p["dst_zone"])
    X["dst_port_wellknown"] = (X["dst_port"] < 1024).astype("int8")
    return X, proto, dirs


def _rolling_past(ts, key, port, dst, windows, tie_rule):
    t_arr = (ts - pd.Timestamp("1970-01-01", tz="UTC")).dt.total_seconds().to_numpy()
    keys, ports, dsts = key.to_numpy(), port.to_numpy(dtype=float), dst.to_numpy()
    n = len(t_arr)
    out = {f"{nm}_{w}s": np.zeros(n, dtype="int32") for w in windows
           for nm in ("cnt", "nports", "ndst")}
    state = [defaultdict(lambda: [deque(), Counter(), Counter()]) for _ in windows]

    def add(k, t, p, ds):
        for st in state:
            dq, cp, cd = st[k]
            dq.append((t, p, ds))
            if p == p:
                cp[p] += 1
            cd[ds] += 1

    def evict(s, t, w):
        dq, cp, cd = s
        while dq and dq[0][0] < t - w:
            _, p, ds = dq.popleft()
            if p == p:
                cp[p] -= 1
                if cp[p] == 0:
                    del cp[p]
            cd[ds] -= 1
            if cd[ds] == 0:
                del cd[ds]

    strict, pending, pend_t = tie_rule == "strict_past", [], None
    for i in range(n):
        t = t_arr[i]
        if strict and pending and pend_t != t:
            for r in pending:
                add(*r)
            pending = []
        for j, w in enumerate(windows):
            s = state[j][keys[i]]
            evict(s, t, w)
            out[f"cnt_{w}s"][i], out[f"nports_{w}s"][i], out[f"ndst_{w}s"][i] = \
                len(s[0]), len(s[1]), len(s[2])
        row = (keys[i], t, ports[i], dsts[i])
        if strict:
            pending.append(row)
            pend_t = t
        else:
            add(*row)
    return pd.DataFrame(out)


def build_features(rows, stream=None):
    """rows: DataFrame or list of dicts (one stream, unique index).
    Returns a DataFrame in the exact column order of the saved model."""
    df = rows.copy() if isinstance(rows, pd.DataFrame) else pd.DataFrame(rows)
    need = ["stream_name", "timestamp", "event_id", "message_sanitized"]
    miss = [c for c in need if c not in df.columns]
    if miss:
        raise ValueError(f"missing required fields: {miss}")
    if stream is None:
        s = df["stream_name"].unique()
        if len(s) != 1:
            raise ValueError("rows must contain exactly one stream_name")
        stream = s[0]
    if stream not in FEATURES:
        raise ValueError(f"unknown stream {stream!r}")
    if not df.index.is_unique:
        raise ValueError("row index must be unique")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    g = df.sort_values(["timestamp", "event_id"], kind="mergesort")
    X, proto, dirs = parse_static(g["message_sanitized"], stream)
    R = _rolling_past(g["timestamp"], X["m_src_ip"], X["dst_port"], X["m_dst_ip"],
                      WINDOWS, TIE_RULE)
    R.index = g.index
    M = pd.concat([X, R], axis=1)
    M["dir_inbound"] = (dirs == "inbound").astype("int8")
    M["dir_outbound"] = (dirs == "outbound").astype("int8")
    for p in ("tcp", "udp", "icmp"):
        M[f"proto_{p}"] = (proto == p).astype("int8")
    freq = pd.Series({float(k): v for k, v in _freq_tables()[stream].items()},
                     dtype="float64")
    M["dst_port_logfreq"] = np.log1p(M["dst_port"].map(freq)).fillna(0.0)
    M = M.fillna(-1)
    return M.loc[df.index, FEATURES[stream]]