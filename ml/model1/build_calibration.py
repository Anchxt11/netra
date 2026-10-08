"""Calibrate model 1's risk score on the validation split (no retraining).

    python ml/model1/build_calibration.py

risk_score = the percentile rank of a row's raw anomaly score among the benign validation rows
of the same stream (AWS VPC and Cisco ASA ranked separately): the share of those reference
scores that are <= this row's score. 0.97 means "more unusual than 97% of normal traffic for
that stream". The alert cutoff is the 99th percentile of the reference scores.

Reads data/interim/pool_split.parquet (on the ML laptop, not in the repo). Features are built over
each stream's full history in time order, as in make_artifacts.py, so the rolling counts match.
Only split == "val" rows with a benign label are used; the test split is never read for this.
Writes ml/model1/calibration.json (the sorted reference scores) and adds a `calibration` block
to thresholds.json, leaving its other keys as they are.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
M1 = ROOT / "ml" / "model1"
sys.path.insert(0, str(ROOT))
from ml.atde.predict import ATDE  # noqa: E402

SPLIT = ROOT / "data/interim/pool_split.parquet"
REFERENCE_SPLIT = "val"
ALERT_QUANTILE = 0.99


def main():
    d = pd.read_parquet(SPLIT)
    if "event_id" not in d.columns:
        d = d.reset_index() if d.index.name == "event_id" else d.assign(event_id=d.index)
    atde = ATDE(explain=False)
    d = d[d.stream_name.isin(atde.iforest)].copy()
    d["malicious"] = d["label_binary"].astype(str).str.lower().isin(["malicious", "1", "true"])

    cal, block = {}, {}
    for stream, g in d.groupby("stream_name"):
        g = g.reset_index(drop=True)
        X = atde.features(g[["stream_name", "timestamp", "event_id", "message_sanitized"]], stream)
        ref_idx = g.index[(g.split == REFERENCE_SPLIT) & (~g.malicious)]
        res = atde.score_features(X.loc[ref_idx], stream, g.loc[ref_idx, "event_id"].tolist())
        ref = np.sort(np.array([r["anomaly_score"] for r in res], dtype="float64"))
        cutoff = round(float(np.quantile(ref, ALERT_QUANTILE, method="higher")), 6)  # a real reference score: false alarms <= 1%
        false_alarm = float((ref > cutoff).mean())
        cal[stream] = {"n_reference": int(len(ref)), "reference_scores": [round(float(v), 6) for v in ref]}
        block[stream] = {"alert_cutoff_anomaly_score": cutoff, "n_reference": int(len(ref)),
                         "false_alarm_rate_on_reference": round(false_alarm, 4)}
        print(f"{stream:18s} reference rows={len(ref):6d} cutoff(p{ALERT_QUANTILE * 100:g})={cutoff:.6f} "
              f"false alarms on reference={false_alarm:.4f} ({int((ref > cutoff).sum())} rows)")

    meta = {"reference": f"split == '{REFERENCE_SPLIT}' and label not malicious, per stream",
            "risk_score": "share of the stream's reference anomaly scores <= this row's anomaly score",
            "alert": f"anomaly_score > alert_cutoff_anomaly_score (the {ALERT_QUANTILE:g} quantile of the reference, numpy method \"higher\")",
            "built": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "command": "python ml/model1/build_calibration.py"}
    (M1 / "calibration.json").write_text(json.dumps({"version": atde.version, **meta, "streams": cal}) + "\n")
    th = json.loads((M1 / "thresholds.json").read_text())
    th["calibration"] = {**{k: meta[k] for k in ("reference", "risk_score", "alert", "built")},
                         "file": "calibration.json", **block}
    (M1 / "thresholds.json").write_text(json.dumps(th, indent=2) + "\n")
    print("wrote", (M1 / "calibration.json").relative_to(ROOT), "and the calibration block in thresholds.json")


if __name__ == "__main__":
    main()
