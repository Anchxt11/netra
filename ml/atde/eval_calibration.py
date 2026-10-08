"""Old cutoff against the calibrated cutoff, on the held-out test split (data/replay/).

    python ml/atde/eval_calibration.py

Scores data/replay/flows_test.jsonl exactly as ml/atde/eval_replay.py does (time order, each stream's
own history), joins data/replay/labels_test.jsonl, and prints, per stream and overall:
  old  is_anomaly (decision_function < 0, anomaly score > 0.5)
  new  above_alert_cutoff (anomaly score > the stream's 99th percentile of benign validation scores)
with precision, recall, F1, the confusion counts and the false-alarm rate on benign test rows, and
PR-AUC of the raw anomaly score and of the calibrated risk_score. The test split is only evaluated
here; the calibration itself comes from the validation split (ml/model1/build_calibration.py).
Prints a Markdown section for docs/ML_EVAL.md.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from sklearn.metrics import average_precision_score

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from ml.atde.predict import ATDE  # noqa: E402

FLOWS = ROOT / "data/replay/flows_test.jsonl"
LABELS = ROOT / "data/replay/labels_test.jsonl"


def counts(y, p):
    tp, fp = int((y & p).sum()), int((~y & p).sum())
    fn, tn = int((y & ~p).sum()), int((~y & ~p).sum())
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {"precision": prec, "recall": rec, "f1": f1, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "far": fp / (fp + tn) if fp + tn else 0.0}


def main():
    flows = pd.read_json(FLOWS, lines=True)
    flows["ts"] = pd.to_datetime(flows["timestamp"], utc=True)
    flows = flows.sort_values(["ts", "event_id"]).reset_index(drop=True)
    atde = ATDE(explain=False)
    res = pd.DataFrame(atde.score(flows))
    d = res.merge(pd.read_json(LABELS, lines=True), on="event_id", validate="1:1")
    d["y"] = d["label_binary"].astype(str).str.lower().isin(["malicious", "1", "true"])
    when = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    cal = atde.thresholds["calibration"]

    lines = [f"Run: `python ml/atde/eval_calibration.py` on {when}, {len(d):,} test rows "
             f"({int(d.y.sum()):,} malicious).", "",
             "| stream | rows (malicious) | cutoff | precision | recall | F1 | TP | FP | FN | TN | false alarms on benign test rows | PR-AUC |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for name, g in [*d.groupby("stream_name"), ("both streams", d)]:
        y = g["y"].to_numpy()
        pr_raw = average_precision_score(y, g["anomaly_score"])
        pr_risk = average_precision_score(y, g["risk_score"])
        for label, col in (("old: anomaly score > 0.5", "is_anomaly"),
                           ("new: risk above the p99 cutoff" + (f" ({cal[name]['alert_cutoff_anomaly_score']:.6f})" if name in cal else ""),
                            "above_alert_cutoff")):
            m = counts(y, g[col].to_numpy(dtype=bool))
            pr = f"{pr_raw:.4f} (raw score)" if col == "is_anomaly" else f"{pr_risk:.4f} (risk score)"
            lines.append(f"| {name} | {len(g):,} ({int(y.sum()):,}) | {label} | {m['precision']:.4f} | {m['recall']:.4f} | "
                         f"{m['f1']:.4f} | {m['tp']:,} | {m['fp']:,} | {m['fn']:,} | {m['tn']:,} | {m['far']:.4f} | {pr} |")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
