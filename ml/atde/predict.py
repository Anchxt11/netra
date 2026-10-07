"""ATDE (model 1) for the live pipeline: load the bundle once, score rows (build plan B1).

    from ml.atde.predict import ATDE
    atde = ATDE()                      # ml/model1/ by default
    atde.score(rows)                   # rows: stream_name, timestamp, event_id, message_sanitized

Features come only from the bundle's own preprocess.py (never re-implemented here). Each result:
  anomaly_score  -score_samples, the bundle's definition (thresholds.json)
  is_anomaly     decision_function < 0
  family         the XGBoost family, or "UNKNOWN": below the 0.9 confidence line, not anomalous,
                 or not run because the row has no per-direction packet and byte split (true for
                 every AWS VPC and Cisco ASA row: see ml/model1/replay_score.py and metrics.json)
  probability    XGBoost's probability for its top family, or None when it did not run
  reasons        top 3 SHAP reasons: the features that pushed this row furthest towards anomalous
"""
import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / "ml" / "model1"
UNKNOWN = "UNKNOWN"
XGB_FEATURES = ["src_packets", "dst_packets", "total_packets", "src_bytes", "dst_bytes", "total_bytes",
                "src_mean_pkt_size", "dst_mean_pkt_size", "proto_tcp", "proto_udp", "proto_icmp", "proto_other"]


def _load_preprocess(bundle: Path):
    """The bundle's own preprocess.py, imported from the bundle folder."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("atde_preprocess", bundle / "preprocess.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ATDE:
    def __init__(self, bundle: Path = BUNDLE, explain: bool = True):
        self.bundle = Path(bundle)
        self.version = (self.bundle / "VERSION").read_text().strip()
        self.pp = _load_preprocess(self.bundle)
        self.thresholds = json.loads((self.bundle / "thresholds.json").read_text())
        self.iforest = {s: joblib.load(self.bundle / f"iforest_{s}.joblib") for s in self.pp.FEATURES}
        for s, m in self.iforest.items():  # the bundle's column order must match the saved model's
            if list(m.feature_names_in_) != self.pp.FEATURES[s]:
                raise ValueError(f"{s}: preprocess.py columns differ from the saved model's")
        art = joblib.load(self.bundle / "stage3_xgb_open_set.joblib")
        self.xgb, self.xgb_threshold = art["model"], float(art["threshold"])
        self.classes = [str(c) for c in joblib.load(self.bundle / "stage3_label_encoder.pkl").classes_]
        self.explain = explain
        self._explainers = {}

    @property
    def model_id(self) -> str:
        return f"atde-{self.version}"  # the `model` value on its alerts (contracts/LIVE_API.md 5.1)

    def _explainer(self, stream):
        if stream not in self._explainers:
            import shap
            self._explainers[stream] = shap.TreeExplainer(self.iforest[stream])
        return self._explainers[stream]

    def features(self, rows, stream=None) -> pd.DataFrame:
        """The Isolation Forest matrix, from the bundle's build_features. Rows must include the history."""
        return self.pp.build_features(rows, stream)

    def score(self, rows, flows=None) -> list[dict]:
        """rows: list of dicts or a DataFrame, one or more streams, in any order, with enough history
        for the rolling windows (600 s AWS, 3600 s Cisco). flows: optional {event_id: {src_packets,
        dst_packets, src_bytes, dst_bytes, proto}} for XGBoost; without it the family is UNKNOWN."""
        df = rows.copy() if isinstance(rows, pd.DataFrame) else pd.DataFrame(rows)
        df = df.reset_index(drop=True)
        out = [None] * len(df)
        for stream, part in df.groupby("stream_name", sort=False):
            X = self.features(part, stream)
            for i, res in zip(X.index, self.score_features(X, stream, part.loc[X.index, "event_id"].tolist(), flows)):
                out[i] = res
        return out

    def score_features(self, X: pd.DataFrame, stream: str, event_ids=None, flows=None) -> list[dict]:
        m = self.iforest[stream]
        Xf = X[list(m.feature_names_in_)].astype("float32")
        raw = m.score_samples(Xf)
        dec = m.decision_function(Xf)
        # SHAP is slow (about 80 rows/s), so only anomalous rows are explained: they are the ones with reasons.
        contrib = {}
        flagged = np.flatnonzero(dec < 0)
        if self.explain and len(flagged):
            for k, v in zip(flagged, self._explainer(stream).shap_values(Xf.iloc[flagged])):
                contrib[int(k)] = v
        ids = event_ids if event_ids is not None else [None] * len(Xf)
        results = []
        for k, (eid, r, d) in enumerate(zip(ids, raw, dec)):
            anomalous = bool(float(d) < 0.0)
            fam, prob, why = UNKNOWN, None, "not anomalous"
            if anomalous:
                f = (flows or {}).get(eid)
                if f is None:
                    why = "not run: the row has no per-direction packet and byte split"
                else:
                    fam, prob, why = self._family(f)
            results.append({
                "event_id": eid, "stream_name": stream, "model": self.model_id,
                "anomaly_score": round(float(-r), 6), "is_anomaly": anomalous,
                "family": fam, "probability": prob, "family_note": why,
                "reasons": self._reasons(Xf.iloc[k], contrib[k]) if k in contrib else [],
            })
        return results

    def _family(self, f: dict):
        p = str(f.get("proto", "")).lower()
        sp, dp, sb, db = (float(f[k]) for k in ("src_packets", "dst_packets", "src_bytes", "dst_bytes"))
        row = [sp, dp, sp + dp, sb, db, sb + db, sb / sp if sp > 0 else 0.0, db / dp if dp > 0 else 0.0,
               int(p == "tcp"), int(p == "udp"), int(p == "icmp"), int(p not in ("tcp", "udp", "icmp"))]
        proba = self.xgb.predict_proba(pd.DataFrame([row], columns=XGB_FEATURES).astype("float32"))[0]
        k = int(proba.argmax())
        conf = round(float(proba[k]), 4)
        if conf < self.xgb_threshold:
            return UNKNOWN, conf, f"below the {self.xgb_threshold} confidence line (closest: {self.classes[k]})"
        return self.classes[k], conf, "classified"

    @staticmethod
    def _reasons(x: pd.Series, shap_row: np.ndarray, n: int = 3) -> list[dict]:
        """Most negative SHAP first: in an Isolation Forest a lower score_samples means more anomalous."""
        order = np.argsort(shap_row)[:n]
        return [{"feature": x.index[i], "value": float(x.iloc[i]), "contribution": round(float(-shap_row[i]), 6),
                 "sentence": f"{x.index[i].replace('_', ' ')} = {float(x.iloc[i]):g}"} for i in order if shap_row[i] < 0]


def _bench(atde: ATDE, n: int = 20000) -> dict:
    """Rows per second on synthetic AWS VPC rows (features + Isolation Forest, then with SHAP)."""
    rng = np.random.default_rng(7)
    t0 = 1722285000
    rows = [{"stream_name": "aws_vpc_flow_log", "event_id": i, "timestamp": pd.Timestamp(t0 + i * 0.05, unit="s", tz="UTC"),
             "message_sanitized": f"2 100000000001 eni-1 10.0.{rng.integers(0, 4)}.{rng.integers(1, 250)} 10.98.236.105 "
                                  f"{rng.integers(1024, 65535)} {rng.choice([22, 80, 443, 8080, 16993])} 6 {rng.integers(1, 20)} "
                                  f"{rng.integers(40, 9000)} {t0} {t0 + 30} ACCEPT OK"} for i in range(n)]
    out = {}
    for label, explain in (("features_and_iforest", False), ("with_shap_on_anomalous_rows", True)):
        atde.explain = explain
        t = time.perf_counter()
        atde.score(rows)
        out[label] = round(n / (time.perf_counter() - t))
    atde.explain = True
    return out


if __name__ == "__main__":
    a = ATDE()
    if len(sys.argv) > 1 and sys.argv[1] == "--bench":
        print(json.dumps({"rows": 20000, "rows_per_second": _bench(a)}))
    else:
        for r in a.score(pd.read_json(sys.argv[1], lines=True)):
            print(json.dumps(r))
