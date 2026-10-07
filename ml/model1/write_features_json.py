import json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import preprocess as pp

def spec(name):
    w = lambda n: n.split("_")[-1]
    if name in ("packets", "bytes"):
        return "AWS flow-log field '%s' parsed from message_sanitized" % name, "float", -1
    if name == "duration":
        return "AWS flow-log end - start, seconds", "float", -1
    if name == "bytes_per_packet":
        return "bytes / max(packets, 1)", "float", -1
    if name in ("icmp_type", "icmp_code"):
        return "ASA '(type X, code Y)' in message; absent for non-ICMP", "int", -1
    if name == "dst_port_wellknown":
        return "1 if destination port < 1024 else 0", "int8", -1
    if name.startswith("cnt_"):
        return "count of earlier events from the same source IP in the past %s (timestamp >= t - w; earlier in (timestamp, event_id) order)" % w(name), "int32", 0
    if name.startswith("nports_"):
        return "distinct destination ports among those events, per source IP, past %s" % w(name), "int32", 0
    if name.startswith("ndst_"):
        return "distinct destination IPs among those events, per source IP, past %s" % w(name), "int32", 0
    if name == "dir_inbound":
        return "1 if direction == inbound. AWS: source external and dest in RFC1918. Cisco: source zone 'outside'", "int8", 0
    if name == "dir_outbound":
        return "1 if direction == outbound. AWS: source RFC1918 and dest external. Cisco: dest zone 'outside' and source zone not 'outside'", "int8", 0
    if name.startswith("proto_"):
        return "1 if protocol == %s (AWS 1/6/17 = icmp/tcp/udp; Cisco proto name)" % name[6:], "int8", 0
    if name == "dst_port_logfreq":
        return "log1p(count of this dst port in TRAIN rows not caught by rules); table in dst_port_freq.json; unseen port = 0.0", "float", 0.0
    raise KeyError(name)

out = {"version": "1.0.0",
       "input_row": ["stream_name", "timestamp", "event_id", "message_sanitized"],
       "ordering": "rows sorted by (timestamp, event_id); window features use past rows only",
       "windows_seconds": {"aws_vpc_flow_log": [60, 600], "cisco_asa": [60, 600, 3600]},
       "missing_value_fill": -1, "dtype_at_scoring": "float32", "streams": {}}
for st, cols in pp.FEATURES.items():
    out["streams"][st] = [dict(zip(("name", "source", "type", "fill"), (n, *spec(n)))) for n in cols]
(HERE / "features.json").write_text(json.dumps(out, indent=2))
print("features.json written:", {k: len(v) for k, v in out["streams"].items()})
