\# ATDE Model Card



\## Version



1.0.0



\## Purpose



Network anomaly detection using a two-stage machine-learning pipeline.



\## Pipeline



1\. Isolation Forest detects anomalous network activity.

2\. XGBoost classifies anomalous activity into an attack family.

3\. Low-confidence XGBoost predictions are marked UNKNOWN/NOVEL.



\## Isolation Forest Models



\### AWS VPC Flow Logs



17 features.



\### Cisco ASA



18 features.



\## XGBoost



12 features.



Eight attack classes:



\- Backdoor / Persistence

\- Credential Attack / Brute Force

\- Data Exfiltration

\- DoS / Flooding

\- Exploitation / RCE

\- Fuzzing

\- Reconnaissance / Scanning

\- Shellcode / Payload Execution



\## Unknown Detection



XGBoost predictions below confidence 0.9 are treated as UNKNOWN/NOVEL.



\## Isolation Forest Decision



An event is anomalous when:



`decision\_function < 0`



\## Risk Score



`risk\_score` (0 to 1) is the share of the same stream's benign validation rows (AWS VPC and Cisco ASA ranked separately) whose Isolation Forest anomaly score is at or below this row's, so 0.97 means "more unusual than 97% of normal traffic for that stream"; it is not a probability of attack and not XGBoost's confidence.



Built by `ml/model1/build\_calibration.py` from the validation split only (`calibration.json`, and the `calibration` block in `thresholds.json`); no model was retrained. The 99th-percentile cutoff (anomaly score 0.662060 AWS, 0.685800 Cisco) catches too few attacks on the test split to use as the alert line (docs/ML\_EVAL.md), so alerts still use `decision\_function < 0`.



\## Intended Use



Real-time network security event scoring.



\## Limitations



The live feature builder must reproduce the same feature definitions and

time-window calculations used during training.



The frontend should not load the ML models directly. Model inference should

run in the backend/API service.



\## Security



Do not expose model files or Python execution directly to an untrusted frontend.

