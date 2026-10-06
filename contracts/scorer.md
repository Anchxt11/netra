# Scorer contract

Team B owns the stable interface:

```python
def score(features: dict) -> float
```

Return a normalized risk score in `[0.0, 1.0]`. The current implementation is `DummyScorer`; the ML teammate can replace it with an IsolationForest/XGBoost-backed implementation without changing the processor or alert contract.
