import json, os
import pandas as pd

df = pd.read_parquet("data/interim/pool_split.parquet")
df = df[(df["split"] == "test") &
        (df["stream_name"].isin(["aws_vpc_flow_log", "cisco_asa"]))].copy()

df["event_id"] = df["event_id"].astype("int64")
df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
df = df.sort_values(["timestamp", "event_id"])

# privacy scan on the text we publish
txt = df["message_sanitized"].astype(str)
checks = {
    "email": r"[\w.+-]+@[\w-]+\.[\w.]+",
    "12-digit AWS account id": r"(?<!\d)\d{12}(?!\d)",
    "secret-like": r"(?i)(password|passwd|secret|token|apikey|api_key)\s*[=:]",
}
for name, pat in checks.items():
    print(f"{name}: {txt.str.contains(pat, regex=True).sum()} rows")
print("rows:", len(df), df["stream_name"].value_counts().to_dict())

os.makedirs("data/replay", exist_ok=True)
with open("data/replay/flows_test.jsonl", "w") as f:
    for r in df.itertuples():
        f.write(json.dumps({"stream_name": r.stream_name,
                            "timestamp": r.timestamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "event_id": int(r.event_id),
                            "message_sanitized": r.message_sanitized}) + "\n")

with open("data/replay/labels_test.jsonl", "w") as f:
    for r in df.itertuples():
        try:
            inc = json.loads(r.incident_ids) if isinstance(r.incident_ids, str) else []
        except Exception:
            inc = [r.incident_ids]
        f.write(json.dumps({"event_id": int(r.event_id),
                            "label_binary": r.label_binary,
                            "incident_ids": inc}) + "\n")

for p in ("flows_test.jsonl", "labels_test.jsonl"):
    print(p, round(os.path.getsize("data/replay/" + p) / 1e6, 1), "MB")

ids = set(df["event_id"])
s = [json.loads(l) for l in open("ml/model1/samples.jsonl")]
print("sample ids found in export:", sum(x["event_id"] in ids for x in s), "of", len(s))