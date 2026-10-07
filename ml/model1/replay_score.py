"""Replay scorer for AWS VPC / Cisco ASA rows: preprocess.build_features -> Isolation Forest.
Usage:
  python ml/model1/replay_score.py rows.jsonl <stream_name>
  python ml/model1/replay_score.py --demo <stream_name> [N]
Rows need: stream_name, timestamp, event_id, message_sanitized, in order, with history.
Stage 2 (XGBoost) is not run: these rows have no src/dst packet or byte split."""
import json, sys
from pathlib import Path
import numpy as np
import pandas as pd
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(ROOT))
import preprocess as pp
from src.if_stage import IFStage

def score_rows(df, stream, only_ids=None, limit=None):
    X = pp.build_features(df, stream)              # needs full history for rolling counts
    if only_ids is not None:
        X = X[df.loc[X.index, "event_id"].isin(only_ids).values]
    if limit:
        X = X.iloc[:limit]
    ifs = IFStage(stream, model_dir=str(HERE))
    Xf = X[ifs.features].astype("float32")         # same cast as IFStage.score
    raw = ifs.model.score_samples(Xf)
    dec = ifs.model.decision_function(Xf)
    out = []
    for (idx, _), rs, ds in zip(Xf.iterrows(), raw, dec):
        a = round(float(-rs), 6)
        anom = bool(float(ds) < 0.0)
        row = df.loc[idx]
        out.append({"stream_name": stream, "event_id": int(row["event_id"]),
                    "timestamp": str(row["timestamp"]),
                    "anomaly_score": a, "is_anomaly": anom,
                    "risk_score": round(min(max(a, 0.0), 1.0), 4),
                    "label": "anomalous" if anom else "benign",
                    "attack_family": "not_run (no packet/byte split)" if anom else None,
                    "model_version": ifs.version})
    return out

if sys.argv[1] == "--demo":
    stream = sys.argv[2]; n = int(sys.argv[3]) if len(sys.argv) > 3 else 20
    d = pd.read_parquet(ROOT / "data/interim/pool_split.parquet")
    if "event_id" not in d.columns:
        d = d.reset_index() if d.index.name == "event_id" else d.assign(event_id=d.index)
    d = d[d.stream_name == stream]
    test_ids = set(d.loc[d.split == "test", "event_id"])
    res = score_rows(d[["stream_name", "timestamp", "event_id", "message_sanitized"]],
                     stream, only_ids=test_ids, limit=n)
else:
    stream = sys.argv[2]
    res = score_rows(pd.read_json(sys.argv[1], lines=True), stream)
for r in res:
    print(json.dumps(r))
