from pathlib import Path
import json
import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    average_precision_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
)

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "ml" / "model1"

# ---------------------------------------------------------
# Load existing trained artifacts — NO RETRAINING
# ---------------------------------------------------------

xgb_pack = joblib.load(
    OUT / "stage3_xgb_open_set.joblib"
)

xgb_model = xgb_pack["model"]
xgb_unknown_threshold = float(
    xgb_pack["threshold"]
)

encoder = joblib.load(
    OUT / "stage3_label_encoder.pkl"
)

if_models = {
    "aws_vpc_flow_log": joblib.load(
        OUT / "iforest_aws_vpc_flow_log.joblib"
    ),
    "cisco_asa": joblib.load(
        OUT / "iforest_cisco_asa.joblib"
    ),
}

# Isolation Forest uses:
# anomaly_score = -score_samples()
# therefore cutoff = -offset_
if_cutoffs = {
    stream: float(-model.offset_)
    for stream, model in if_models.items()
}

# ---------------------------------------------------------
# Load actual test data
# ---------------------------------------------------------

df = pd.read_parquet(
    ROOT / "data" / "interim" / "pool_split.parquet"
)

if_scores = pd.read_parquet(
    ROOT / "data" / "processed" / "if_scores.parquet"
)

data = df.merge(
    if_scores[
        [
            "event_id",
            "stream_name",
            "rule_caught",
            "anomaly_score",
        ]
    ],
    on=["event_id", "stream_name"],
    how="inner",
    validate="one_to_one",
)

# Model 1 IF evaluates events not already caught by rules.
test = data[
    (data["split"] == "test")
    & (~data["rule_caught"].astype(bool))
].copy()

if test.empty:
    raise RuntimeError(
        "No residual test rows found."
    )

test["y_true"] = (
    test["label_binary"]
    .astype(str)
    .str.lower()
    .eq("malicious")
    .astype(int)
)

test["if_cutoff"] = test[
    "stream_name"
].map(if_cutoffs)

test["y_pred"] = (
    test["anomaly_score"]
    >= test["if_cutoff"]
).astype(int)

# ---------------------------------------------------------
# 1. metrics.json
# ---------------------------------------------------------

metrics = {
    "version": "1.0.0",
    "evaluation_unit": (
        "residual test rows not caught "
        "by backend rules"
    ),
    "positive_class": "malicious",
    "test_rows": int(len(test)),

    "precision": float(
        precision_score(
            test["y_true"],
            test["y_pred"],
            zero_division=0,
        )
    ),

    "recall": float(
        recall_score(
            test["y_true"],
            test["y_pred"],
            zero_division=0,
        )
    ),

    "f1": float(
        f1_score(
            test["y_true"],
            test["y_pred"],
            zero_division=0,
        )
    ),

    "pr_auc": float(
        average_precision_score(
            test["y_true"],
            test["anomaly_score"],
        )
    ),

    "confusion_matrix": confusion_matrix(
        test["y_true"],
        test["y_pred"],
        labels=[0, 1],
    ).tolist(),

    "confusion_matrix_labels": [
        "benign",
        "malicious",
    ],

    "per_stream": {},
}

for stream, group in test.groupby(
    "stream_name"
):
    metrics["per_stream"][stream] = {
        "test_rows": int(len(group)),

        "precision": float(
            precision_score(
                group["y_true"],
                group["y_pred"],
                zero_division=0,
            )
        ),

        "recall": float(
            recall_score(
                group["y_true"],
                group["y_pred"],
                zero_division=0,
            )
        ),

        "f1": float(
            f1_score(
                group["y_true"],
                group["y_pred"],
                zero_division=0,
            )
        ),

        "pr_auc": (
            float(
                average_precision_score(
                    group["y_true"],
                    group["anomaly_score"],
                )
            )
            if group["y_true"].nunique() > 1
            else None
        ),

        "confusion_matrix": confusion_matrix(
            group["y_true"],
            group["y_pred"],
            labels=[0, 1],
        ).tolist(),
    }

(OUT / "metrics.json").write_text(
    json.dumps(metrics, indent=2),
    encoding="utf-8",
)

# ---------------------------------------------------------
# 2. thresholds.json
# ---------------------------------------------------------

thresholds = {
    "version": "1.0.0",

    "isolation_forest": {
        stream: {
            "anomaly_cutoff": cutoff,
            "derivation": (
                "-IsolationForest.offset_ "
                "because anomaly_score = -score_samples"
            ),
        }
        for stream, cutoff in if_cutoffs.items()
    },

    "xgboost": {
        "unknown_confidence_below":
            xgb_unknown_threshold,

        "artifact":
            "stage3_xgb_open_set.joblib"
    },
}

(OUT / "thresholds.json").write_text(
    json.dumps(thresholds, indent=2),
    encoding="utf-8",
)

# ---------------------------------------------------------
# 3. samples.jsonl
# ---------------------------------------------------------

SEVERITY = {
    "Backdoor / Persistence": "critical",
    "Data Exfiltration": "critical",
    "Shellcode / Payload Execution": "high",
    "Exploitation / RCE": "high",
    "Credential Attack / Brute Force": "high",
    "DoS / Flooding": "medium",
    "Reconnaissance / Scanning": "medium",
    "Fuzzing": "low",
}


def family_name(index):
    try:
        return str(
            encoder.inverse_transform(
                [index]
            )[0]
        )
    except Exception:
        return str(index)


def predict_xgb(row):
    from src.xgb_stage import build_xgb_features

    feats = build_xgb_features(
        float(row["src_packets"]),
        float(row["dst_packets"]),
        float(row["src_bytes"]),
        float(row["dst_bytes"]),
        row["proto"],
    )

    X = pd.DataFrame(
        [[feats[f] for f in xgb_model.feature_names_in_]]
        if hasattr(xgb_model, "feature_names_in_")
        else [[feats[f] for f in [
            "src_packets",
            "dst_packets",
            "total_packets",
            "src_bytes",
            "dst_bytes",
            "total_bytes",
            "src_mean_pkt_size",
            "dst_mean_pkt_size",
            "proto_tcp",
            "proto_udp",
            "proto_icmp",
            "proto_other",
        ]]]
    )

    probabilities = xgb_model.predict_proba(X)[0]
    prediction = int(np.argmax(probabilities))
    confidence = float(probabilities[prediction])

    family = family_name(prediction)

    top3 = [
        {
            "attack_family": family_name(int(i)),
            "confidence": float(probabilities[i]),
        }
        for i in np.argsort(probabilities)[::-1][:3]
    ]

    return family, confidence, top3

    

def json_value(value):

    if pd.isna(value):
        return None

    if isinstance(
        value,
        np.integer,
    ):
        return int(value)

    if isinstance(
        value,
        np.floating,
    ):
        return float(value)

    if isinstance(
        value,
        pd.Timestamp,
    ):
        return value.isoformat()

    return value


sample_columns = [
    "event_id",
    "timestamp",
    "stream_name",
    "src_ip",
    "dst_ip",
    "src_packets",
    "dst_packets",
    "src_bytes",
    "dst_bytes",
    "proto",
]

available_columns = [
    c
    for c in sample_columns
    if c in test.columns
]

samples = test.sort_values(
    ["timestamp", "event_id"]
).head(100)

with (
    OUT / "samples.jsonl"
).open(
    "w",
    encoding="utf-8",
) as file:

    for _, row in samples.iterrows():

        if_score = float(
            row["anomaly_score"]
        )

        cutoff = float(
            row["if_cutoff"]
        )

        expected = {
            "event_id":
                json_value(
                    row["event_id"]
                ),

            "ts":
                json_value(
                    row.get("timestamp")
                ),

            "entity":
                json_value(
                    row.get(
                        "src_ip",
                        "",
                    )
                ),

            "detected_by":
                "anomaly_model",

            "if_score":
                round(
                    max(
                        0.0,
                        min(
                            1.0,
                            if_score,
                        ),
                    ),
                    4,
                ),

            "score":
                round(
                    max(
                        0.0,
                        min(
                            1.0,
                            if_score,
                        ),
                    ),
                    4,
                ),

            "label":
                "benign",

            "severity":
                "low",

            "is_attack":
                False,

            "attack_family":
                None,

            "family_confidence":
                None,

            "top3":
                None,
        }

        # Anomalous -> XGBoost
        if if_score >= cutoff:

            family, confidence, top3 = (
                predict_xgb(row)
            )

            if (
                confidence
                < xgb_unknown_threshold
            ):

                expected.update({
                    "label":
                        "suspicious",

                    "severity":
                        "medium",

                    "is_attack":
                        True,

                    "attack_family":
                        "UNKNOWN",

                    "closest_family":
                        family,

                    "family_confidence":
                        confidence,

                    "top3":
                        top3,
                })

            else:

                expected.update({
                    "label":
                        "attack",

                    "severity":
                        SEVERITY.get(
                            family,
                            "medium",
                        ),

                    "is_attack":
                        True,

                    "attack_family":
                        family,

                    "closest_family":
                        family,

                    "family_confidence":
                        confidence,

                    "top3":
                        top3,
                })

        raw_input = {
            column:
                json_value(row[column])
            for column in available_columns
        }

        file.write(
            json.dumps({
                "input": raw_input,
                "expected_output": expected,
            })
            + "\n"
        )

print()
print("DONE")
print(
    "Created:",
    OUT / "metrics.json",
)
print(
    "Created:",
    OUT / "thresholds.json",
)
print(
    "Created:",
    OUT / "samples.jsonl",
)
print(
    "Samples:",
    len(samples),
)