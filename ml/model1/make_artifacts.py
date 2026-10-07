import json, sys
from pathlib import Path
import joblib, numpy as np, pandas as pd
from sklearn.metrics import (average_precision_score, confusion_matrix,
                             precision_recall_fscore_support)

ROOT = Path(__file__).resolve().parents[2]
M1 = ROOT / "ml" / "model1"
sys.path.insert(0, str(M1))
import preprocess as pp

d = pd.read_parquet(ROOT / "data/interim/pool_split.parquet")
if "event_id" not in d.columns:
    d = d.reset_index() if d.index.name == "event_id" else d.assign(event_id=d.index)
sc = pd.read_parquet(ROOT / "data/processed/if_scores.parquet")
assert set(d.event_id) == set(sc.event_id), "event_id mismatch with if_scores"
d = d.merge(sc[["event_id", "rule_caught", "anomaly_score"]]
            .rename(columns={"anomaly_score": "stored"}), on="event_id", validate="1:1")
d = d[d.stream_name.isin(pp.FEATURES)].copy()
d["y"] = d["label_binary"].astype(str).str.lower().isin(["malicious", "1", "true"])

# 1. port tables from TRAIN rows not caught by rules (matches notebook fit_mask)
tables = {}
for st, g in d.groupby("stream_name"):
    fit = g[(g.split == "train") & (~g.rule_caught)]
    X, _, _ = pp.parse_static(fit["message_sanitized"], st)
    vc = X["dst_port"].value_counts()
    tables[st] = {str(int(k)): int(v) for k, v in vc.items()}
(M1 / "dst_port_freq.json").write_text(json.dumps(tables))
pp._FREQ = None

# 2. rebuild features, score with the saved models, verify
F, ok = {}, True
d["new"] = np.nan
for st, g in d.groupby("stream_name"):
    m = joblib.load(M1 / f"iforest_{st}.joblib")
    X = pp.build_features(g[["stream_name", "timestamp", "event_id", "message_sanitized"]], st)
    assert list(X.columns) == list(m.feature_names_in_), "feature order differs"
    d.loc[g.index, "new"] = -m.score_samples(X.astype("float32"))
    F[st] = X
    for sp, gg in g.groupby("split"):
        diff = (d.loc[gg.index, "new"] - gg.stored).abs()
        flag = sp != "train"           # train residual stored scores are out-of-fold
        print(f"{st:18s} {sp:5s} n={len(gg):6d} max|diff|={diff.max():.2e} "
              f"within1e-4={(diff < 1e-4).mean():.4f}" + ("" if flag else "  (OOF, ignored)"))
        if flag and diff.max() > 1e-4:
            ok = False
if not ok:
    sys.exit("VERIFICATION FAILED - not writing deliverables. Paste the table above.")

# 3. metrics on residual test rows (IF stage, cutoff 0.5 on anomaly_score)
CUT = 0.5
t = d[(d.split == "test") & (~d.rule_caught)]
def stats(g):
    y, s = g.y.values, g.new.values
    p, r, f, _ = precision_recall_fscore_support(y, s > CUT, average="binary", zero_division=0)
    tn, fp, fn, tp = confusion_matrix(y, s > CUT, labels=[False, True]).ravel()
    return {"n": int(len(g)), "n_malicious": int(y.sum()), "precision": float(p),
            "recall": float(r), "f1": float(f),
            "pr_auc": float(average_precision_score(y, s)) if y.any() else None,
            "confusion_matrix": {"labels": ["benign", "malicious"],
                                 "matrix": [[int(tn), int(fp)], [int(fn), int(tp)]]}}
metrics = {"scope": "Isolation Forest stage, test split, rows not caught by rules",
           "anomaly_cutoff": CUT, "combined": stats(t),
           **{st: stats(g) for st, g in t.groupby("stream_name")},
           "xgboost": "not evaluated: AWS/Cisco rows have no src/dst packet or byte split"}
(M1 / "metrics.json").write_text(json.dumps(metrics, indent=2))

# 4. thresholds
(M1 / "thresholds.json").write_text(json.dumps({
    "version": "1.0.0",
    "isolation_forest": {
        "score": "anomaly_score = -score_samples(X float32); anomalous if decision_function < 0",
        "aws_vpc_flow_log": {"anomaly_cutoff": 0.5, "offset_": -0.5},
        "cisco_asa": {"anomaly_cutoff": 0.5, "offset_": -0.5}},
    "xgboost": {"unknown_confidence_below": 0.9}}, indent=2))

# 5. samples: 50 per stream, positives first, exact outputs of preprocess + model
rng = np.random.RandomState(42)
lines = []
for st, g in d[d.split == "test"].groupby("stream_name"):
    pos = g[g.y]; neg = g[~g.y]
    pick = pd.concat([pos.sample(min(25, len(pos)), random_state=42),
                      neg.sample(min(50 - min(25, len(pos)), len(neg)), random_state=42)])
    for i, r in pick.sort_values("event_id").iterrows():
        lines.append(json.dumps({
            "stream_name": st, "event_id": int(r.event_id),
            "timestamp": pd.Timestamp(r.timestamp).isoformat(),
            "message_sanitized": r.message_sanitized,
            "features": {k: float(v) for k, v in F[st].loc[i].items()},
            "anomaly_score": round(float(r.new), 6),
            "is_anomaly": bool(r.new > CUT), "label_malicious": bool(r.y)}))
(M1 / "samples.jsonl").write_text("\n".join(lines) + "\n")
print("OK:", len(lines), "samples written")