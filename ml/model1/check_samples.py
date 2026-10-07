import json, subprocess, sys
N = 50000  # Cisco test set has 44,598 rows
samples = [json.loads(l) for l in open("ml/model1/samples.jsonl")]
bad = tot = 0
for stream in ("aws_vpc_flow_log", "cisco_asa"):
    want = {s["event_id"]: s for s in samples if s["stream_name"] == stream}
    if not want:
        continue
    out = subprocess.run(
        [sys.executable, "ml/model1/replay_score.py", "--demo", stream, str(N)],
        capture_output=True, text=True).stdout
    got = {}
    for line in out.splitlines():
        try:
            r = json.loads(line)
            got[r["event_id"]] = r
        except Exception:
            pass
    for eid, s in want.items():
        tot += 1
        g = got.get(eid)
        if g is None:
            print(stream, eid, "NOT REACHED"); bad += 1
        elif abs(g["anomaly_score"] - s["anomaly_score"]) > 1e-4:
            print(stream, eid, "MISMATCH", g["anomaly_score"], s["anomaly_score"]); bad += 1
print(f"checked {tot}, problems {bad}")