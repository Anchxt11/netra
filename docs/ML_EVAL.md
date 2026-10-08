# ML Evaluation – ATDE Model 1 (held-out test set)

> The first section comes from `python ml/model1/build_calibration.py` and `python ml/atde/eval_calibration.py` (2026-10-08). The second comes from `python ml/atde/eval_replay.py` (2026-10-07 06:43 UTC). Only numbers from these runs appear here.
> Re-running `eval_replay.py` rewrites this whole file: copy the first section back afterwards.

## Calibrated risk score (2026-10-08): new against old

`risk_score` is now the percentile rank of a row's raw anomaly score among the **benign validation rows of the same stream** (AWS VPC and Cisco ASA ranked separately). It used to be the raw score clamped to 0..1. The proposed alert cutoff is the 99th percentile of those reference scores. No model was retrained. The four model files keep their SHA-256 hashes.

**Calibration** (validation split only; the test split is never used for it):
`python ml/model1/build_calibration.py` on 2026-10-08 06:52 UTC, from `data/interim/pool_split.parquet` (ML laptop, not in the repo):

| stream | benign validation rows (reference) | alert cutoff (anomaly score, p99, numpy `method="higher"`) | false alarms on the reference |
|---|---|---|---|
| aws_vpc_flow_log | 1,466 | 0.662060 | 0.0095 (14 rows) |
| cisco_asa | 25,218 | 0.685800 | 0.0100 (251 rows) |

**Evaluation on the held-out test split** (`data/replay/`, the same 57,758 rows as the 2026-10-07 run below; the old rows reproduce that run exactly):

Run: `python ml/atde/eval_calibration.py` on 2026-10-08 06:54 UTC, 57,758 test rows (3,824 malicious).

| stream | rows (malicious) | cutoff | precision | recall | F1 | TP | FP | FN | TN | false alarms on benign test rows | PR-AUC |
|---|---|---|---|---|---|---|---|---|---|---|---|
| aws_vpc_flow_log | 13,160 (3,113) | old: anomaly score > 0.5 | 0.2302 | 0.6136 | 0.3348 | 1,910 | 6,386 | 1,203 | 3,661 | 0.6356 | 0.2374 (raw score) |
| aws_vpc_flow_log | 13,160 (3,113) | new: risk above the p99 cutoff (0.662060) | 0.0500 | 0.0003 | 0.0006 | 1 | 19 | 3,112 | 10,028 | 0.0019 | 0.2384 (risk score) |
| cisco_asa | 44,598 (711) | old: anomaly score > 0.5 | 0.0734 | 0.9845 | 0.1367 | 700 | 8,831 | 11 | 35,056 | 0.2012 | 0.1358 (raw score) |
| cisco_asa | 44,598 (711) | new: risk above the p99 cutoff (0.685800) | 0.0191 | 0.0281 | 0.0228 | 20 | 1,025 | 691 | 42,862 | 0.0234 | 0.1354 (risk score) |
| both streams | 57,758 (3,824) | old: anomaly score > 0.5 | 0.1464 | 0.6825 | 0.2411 | 2,610 | 15,217 | 1,214 | 38,717 | 0.2821 | 0.1671 (raw score) |
| both streams | 57,758 (3,824) | new: risk above the p99 cutoff | 0.0197 | 0.0055 | 0.0086 | 21 | 1,044 | 3,803 | 52,890 | 0.0194 | 0.0814 (risk score) |


Within one stream, PR-AUC barely changes between the raw score and the risk score: the risk score keeps the raw score's order, and only ties shift it a little. The "both streams" risk-score PR-AUC mixes two separately ranked streams, so it is not comparable with the raw-score figure.

**What this shows:**
- **The 1 % cutoff is not a usable alert line on the test split.** Recall falls to 0.0003 (AWS) and 0.0281 (Cisco), and precision does not improve (0.0500 and 0.0191). Malicious Cisco test rows have a median anomaly score of 0.616: above the old 0.5 line, but below the benign 99th percentile of 0.686.
- **AWS has no ranking signal.** Its PR-AUC (0.2374) equals the share of malicious rows (0.2366). On the validation split, all 1,466 benign rows and all 432 malicious rows score above 0.5. The benign median moves from 0.466 (train) to 0.592 (validation) to 0.550 (test), so the validation reference sits higher than most test traffic. False alarms on benign test rows are 0.0019 (AWS) and 0.0234 (Cisco), against the 0.01 target.
- **Live alerting therefore still uses the old line** (`is_anomaly`, anomaly score > 0.5). Only the meaning of `risk_score` changes. Among the test rows the old line flags, the risk score has a median of 0.9213 on Cisco, and 0.5621 on AWS, where 40.6 % of flagged rows score below 0.5.

The per-split medians and flagged-row risk quantiles above come from diagnostic runs on the same data on 2026-10-08. Those runs are not saved as scripts in the repo.

---

# Earlier run (2026-10-07, old cutoff only)

## Run details

| Item | Value |
|---|---|
| Command | `python ml/atde/eval_replay.py` |
| Flows file | `data/replay/flows_test.jsonl` |
| Labels file | `data/replay/labels_test.jsonl` |
| Rows in flows file | 57,758 |
| Rows in labels file | 57,758 |
| Rows scored | 57,758 |
| Rows joined (scored ∩ labelled) | 57,758 |
| Date of data export | 2026-10-07 |
| Anomaly cutoff | `decision_function < 0` (Isolation Forest offset = `0.5`) |

## Overall results (both streams)

| Metric | Value |
|---|---|
| Scored rows | 57,758 |
| Malicious rows | 3,824 |
| Precision | 0.1464 |
| Recall | 0.6825 |
| F1 Score | 0.2411 |

**Confusion matrix** (rows = true label, columns = predicted):

|  | Predicted benign | Predicted anomalous | Total |
|---|---|---|---|
| **True benign** | 38,717 (TN) | 15,217 (FP) | 53,934 |
| **True malicious** | 1,214 (FN) | 2,610 (TP) | 3,824 |
| **Total** | 39,931 | 17,827 | 57,758 |

## Per-stream results

### AWS VPC Flow Log (`aws_vpc_flow_log`)

| Metric | Value |
|---|---|
| Scored rows | 13,160 |
| Malicious rows | 3,113 |
| Precision | 0.2302 |
| Recall | 0.6136 |
| F1 Score | 0.3348 |
| True Positives (TP) | 1,910 |
| False Positives (FP) | 6,386 |
| False Negatives (FN) | 1,203 |
| True Negatives (TN) | 3,661 |

### Cisco ASA (`cisco_asa`)

| Metric | Value |
|---|---|
| Scored rows | 44,598 |
| Malicious rows | 711 |
| Precision | 0.0734 |
| Recall | 0.9845 |
| F1 Score | 0.1367 |
| True Positives (TP) | 700 |
| False Positives (FP) | 8,831 |
| False Negatives (FN) | 11 |
| True Negatives (TN) | 35,056 |

## Cooldown alert simulation

Applying `ml-scorer`'s 1-per-source-address-per-minute cooldown policy to all anomalous rows:

| Stat | Value |
|---|---|
| Raw anomalous rows flagged | 17,827 |
| Alerts ml-scorer would actually emit | 3,662 |
| Alert rate reduction from cooldown | 79.5% |

## Time-to-detect per labelled incident

| Stat | Value |
|---|---|
| Total labelled incidents | 621 |
| Incidents detected (≥1 anomalous row) | 616 (99.2%) |
| Mean time to detect | 0.01 seconds |
| Minimum time to detect | 0.00 seconds |
| Maximum time to detect | 1.00 seconds |

## XGBoost status & limitations

- **XGBoost classification**: XGBoost stage 3 **does not run** on these streams because AWS VPC Flow Logs and Cisco ASA records do not contain per-direction packet and byte breakdown (`src_packets`, `dst_packets`, `src_bytes`, `dst_bytes`). Consequently, all anomalous rows receive `family = "UNKNOWN"` and `probability = null`.
- **Operating characteristic**: Model 1 exhibits high recall (68.3% overall, 98.5% on Cisco ASA) with moderate precision (14.6% overall), reflecting a security posture that minimizes missed breaches (low false negatives) while relying on alert correlation, rule hits, and the 60-second per-address cooldown to manage analyst alert volume.
- **Coverage boundary**: The model was trained specifically on network flow logs (AWS VPC and Cisco ASA). Web request logs from the live lab (Juice Shop / Nginx) have distinct schemas and are safely classified as non-scorable without synthetic score fabrication.
