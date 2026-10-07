"""
Module 1 entry point.

Pipeline:

    backend rule hit
        -> immediate attack result

    otherwise
        -> Isolation Forest anomaly gate
        -> if below threshold: benign
        -> if above threshold: XGBoost family classifier
        -> JSON-compatible result

No labels are used by the Isolation Forest stage.

The Isolation Forest stage must receive the SAME feature representation
used during its training. This module therefore treats IF scoring as
an adapter/stage rather than passing a raw event dict directly to sklearn.
"""

import math
import time

try:
    from .if_stage import IFStage
    from .xgb_stage import XGBStage, build_xgb_features, UNKNOWN
except (ImportError, ValueError):
    from if_stage import IFStage
    from xgb_stage import XGBStage, build_xgb_features, UNKNOWN

try:
    from model_2_temp.crie_deployment.crie_engine import model1_to_crie
except (ImportError, ValueError):
    import sys
    from pathlib import Path
    _repo_root = Path(__file__).resolve().parent.parent
    if str(_repo_root) not in sys.path:
        sys.path.insert(0, str(_repo_root))
    _crie_dir = _repo_root / "model_2_temp" / "crie_deployment"
    if str(_crie_dir) not in sys.path:
        sys.path.insert(0, str(_crie_dir))
    try:
        from model_2_temp.crie_deployment.crie_engine import model1_to_crie
    except (ImportError, ValueError):
        from crie_engine import model1_to_crie


# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------

SEVERITY_BY_FAMILY = {
    "Backdoor / Persistence": "critical",
    "Data Exfiltration": "critical",
    "Shellcode / Payload Execution": "high",
    "Exploitation / RCE": "high",
    "Credential Attack / Brute Force": "high",
    "DoS / Flooding": "medium",
    "Reconnaissance / Scanning": "medium",
    "Fuzzing": "low",
}


# These are the fields required by the public score_event() contract.
REQUIRED = [
    "event_id",
    "ts",
    "src_packets",
    "dst_packets",
    "src_bytes",
    "dst_bytes",
    "proto",
]


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def _finite_nonnegative(value, name):
    """Validate a numeric event field."""

    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
    ):
        raise ValueError(
            f"{name} must be a finite number >= 0, got {value!r}"
        )


def _clamp01(value):
    """Clamp a numeric score into [0, 1]."""

    return min(max(float(value), 0.0), 1.0)


# ---------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------

class Detector:
    """
    High-level detector integrating Model 1 anomaly/family classification
    with Model 2 CRIE remediation recommendation engine.

    Parameters
    ----------
    if_stage:
        Adapter around the trained Isolation Forest.

        It must expose:

            score(event) -> float

        or:

            score(event) -> {
                "score": ...,
                "threshold": ...
            }

        where the adapter is responsible for turning the event into the
        exact IF feature representation used during training.

    xgb_stage:
        XGBStage instance.

    crie_adapter:
        Optional custom adapter function for Model 2 (defaults to model1_to_crie).

    enable_remediation:
        Whether to attach Model 2 remediation recommendations for applicable attacks (default True).
    """

    def __init__(
        self,
        if_stage,
        xgb_stage=None,
        model_dir="models",
        crie_adapter=None,
        enable_remediation=True,
    ):
        self.if_stage = if_stage

        self.xgb = xgb_stage or XGBStage(model_dir)

        self.crie_adapter = crie_adapter or model1_to_crie
        self.enable_remediation = enable_remediation

        if not hasattr(self.if_stage, "score"):
            raise TypeError(
                "if_stage must provide score(event) -> float"
            )

        # Keep the version visible in every result.
        if_version = getattr(
            self.if_stage,
            "version",
            "if_unknown"
        )

        xgb_version = getattr(
            self.xgb,
            "version",
            "xgb_unknown"
        )

        self.version = f"m1-v1|if:{if_version}|xgb:{xgb_version}"

    # -----------------------------------------------------------------
    # Public entry point
    # -----------------------------------------------------------------

    def score_event(
        self,
        event,
        rule_hit=None,
        alert_context=None,
        top_k=3,
    ):
        """
        Score one event.

        Order is deliberately:

            1. validate event
            2. backend rule
            3. Isolation Forest
            4. threshold gate
            5. XGBoost family classification
            6. Model 2 CRIE remediation recommendation (for applicable attacks)
        """

        t0 = time.perf_counter()

        self._validate_event(event)

        out = {
            "event_id": event["event_id"],
            "ts": event["ts"],
            "entity": event.get("src_ip", ""),

            "model_version": self.version,

            "detected_by": "none",

            "attack_family": None,
            "closest_family": None,
            "family_confidence": None,
            "top3": None,

            "if_score": None,
            "score": 0.0,

            "label": "benign",
            "severity": "low",
            "is_attack": False,
            "is_unknown": False,

            "severity_source": None,
            "explanation": None,

            "latency_ms": None,
            "remediation": None,
        }

        # =============================================================
        # Stage 1: backend rule
        # =============================================================

        if rule_hit:
            category = rule_hit.get("category")

            severity = rule_hit.get(
                "severity",
                SEVERITY_BY_FAMILY.get(category, "high"),
            )

            out.update(
                detected_by="rule",
                is_attack=True,
                score=1.0,
                label="attack",
                severity=severity,
                attack_family=category,
                is_unknown=False,
                explanation=(
                    f"Matched backend rule "
                    f"{rule_hit.get('rule_id', '?')}"
                ),
                severity_source="rule",
            )

            self._apply_remediation(
                out,
                event=event,
                is_unknown=False,
                alert_context=alert_context,
                top_k=top_k,
            )

            out["latency_ms"] = self._latency_ms(t0)

            return out

        # =============================================================
        # Stage 2a: Isolation Forest anomaly gate
        # =============================================================

        if_result = self.if_stage.score(event)

        # Support either:
        #
        #   score(event) -> float
        #
        # or:
        #
        #   score(event) -> {"score": ..., "threshold": ...}
        #
        # or:
        #
        #   score(event) -> {"anomaly_score": ..., "decision_score": ..., "is_anomaly": ...}

        if isinstance(if_result, dict):

            if "is_anomaly" in if_result:
                is_anomaly = bool(if_result["is_anomaly"])
                if_score = float(if_result.get("anomaly_score", if_result.get("score", 0.0)))
                threshold = float(if_result.get("threshold", 0.5))

            elif "score" in if_result:
                if_score = float(if_result["score"])
                threshold = float(
                    if_result.get("threshold", 0.0)
                )
                is_anomaly = if_score >= threshold

            elif "anomaly_score" in if_result:
                if_score = float(if_result["anomaly_score"])
                threshold = float(
                    if_result.get("threshold", 0.5)
                )
                is_anomaly = if_score >= threshold

            elif "decision_score" in if_result:
                dec = float(if_result["decision_score"])
                is_anomaly = dec < 0.0
                if_score = float(if_result.get("anomaly_score", max(0.0, -dec)))
                threshold = 0.0

            else:
                raise ValueError(
                    "Isolation Forest result must contain "
                    "'score', 'anomaly_score', or 'decision_score'."
                )

        else:
            if_score = float(if_result)

            threshold = float(
                getattr(
                    self.if_stage,
                    "threshold",
                    0.0
                )
            )
            is_anomaly = if_score >= threshold

        if_score = _clamp01(if_score)

        out["if_score"] = round(if_score, 4)

        # -------------------------------------------------------------
        # Below anomaly threshold
        # -------------------------------------------------------------

        if not is_anomaly:

            out.update(
                detected_by="anomaly_model",
                is_attack=False,
                score=round(if_score, 4),
                label="benign",
                severity="low",
                is_unknown=False,
                severity_source="anomaly_threshold",
                explanation=(
                    f"Anomaly score {if_score:.2f} below "
                    f"threshold {threshold:.2f}"
                ),
            )

            self._apply_remediation(
                out,
                event=event,
                is_unknown=False,
                alert_context=alert_context,
                top_k=top_k,
            )

            out["latency_ms"] = self._latency_ms(t0)

            return out

        # =============================================================
        # Stage 2b: XGBoost family classification
        # =============================================================

        feats = build_xgb_features(
            event["src_packets"],
            event["dst_packets"],
            event["src_bytes"],
            event["dst_bytes"],
            event["proto"],
        )

        result = self.xgb.predict(feats)

        attack_family = result.get("attack_family")
        closest_family = result.get("closest_family")
        confidence = result.get("confidence")
        top3 = result.get("top3")
        is_unknown = bool(result.get("is_unknown", False))

        if confidence is not None:
            confidence = float(confidence)

        # -------------------------------------------------------------
        # Unknown / low-confidence XGBoost classification
        # -------------------------------------------------------------

        if is_unknown:

            out.update(
                detected_by="anomaly_model",
                is_attack=True,
                score=round(if_score, 4),
                label="suspicious",
                severity="medium",
                attack_family=UNKNOWN,
                closest_family=closest_family,
                family_confidence=confidence,
                top3=top3,
                is_unknown=True,
                severity_source="anomaly_model",
                explanation=(
                    f"Anomalous traffic detected "
                    f"(score {if_score:.2f}), but the family "
                    f"classifier is uncertain"
                ),
            )

            self._apply_remediation(
                out,
                event=event,
                is_unknown=True,
                alert_context=alert_context,
                top_k=top_k,
            )

        # -------------------------------------------------------------
        # Known XGBoost family
        # -------------------------------------------------------------

        else:

            severity = SEVERITY_BY_FAMILY.get(
                attack_family,
                "medium",
            )

            out.update(
                detected_by="anomaly_model",
                is_attack=True,
                score=round(if_score, 4),
                label="attack",
                severity=severity,
                attack_family=attack_family,
                closest_family=closest_family,
                family_confidence=confidence,
                top3=top3,
                is_unknown=False,
                severity_source="provisional_family_table",
                explanation=(
                    f"Anomalous traffic detected "
                    f"(score {if_score:.2f}) and classified as "
                    f"{attack_family} "
                    f"with {confidence:.0%} confidence"
                    if confidence is not None
                    else
                    f"Anomalous traffic detected "
                    f"(score {if_score:.2f}) and classified as "
                    f"{attack_family}"
                ),
            )

            self._apply_remediation(
                out,
                event=event,
                is_unknown=False,
                alert_context=alert_context,
                top_k=top_k,
            )

        out["latency_ms"] = self._latency_ms(t0)

        return out

    # -----------------------------------------------------------------
    # Model 2 Remediation Application
    # -----------------------------------------------------------------

    def _apply_remediation(
        self,
        out,
        event,
        is_unknown=False,
        alert_context=None,
        top_k=3,
    ):
        """
        Run Model 2 CRIE remediation adapter for applicable attack events.

        Preserves Model 1 behavior:
        - Benign and UNKNOWN/NOVEL events safely result in remediation=None
          (handled cleanly via adapter's existing skipped behavior).
        - Applicable attack events receive Model 2's ranked recommendations.
        """
        out["remediation"] = None

        if not self.enable_remediation or not self.crie_adapter:
            return

        # Prepare alert context from event fields and caller overrides
        ctx = dict(event)
        if "src_ip" not in ctx and out.get("entity"):
            ctx["src_ip"] = out["entity"]
        if alert_context:
            ctx.update(alert_context)

        # Fallback confidence to 1.0 if not provided or None (e.g. on rule hits)
        conf = out.get("family_confidence")
        if conf is None:
            conf = out.get("confidence")
        if conf is None:
            conf = 1.0

        m1_result = {
            **out,
            "is_unknown": is_unknown,
            "confidence": float(conf),
            "family_confidence": float(conf),
        }

        try:
            crie_res = self.crie_adapter(
                m1_result,
                alert_context=ctx,
                top_k=top_k,
            )

            if isinstance(crie_res, dict) and crie_res.get("success"):
                out["remediation"] = crie_res
            else:
                out["remediation"] = None
        except Exception:
            # Safe degradation: do not fail detection pipeline
            out["remediation"] = None

    # -----------------------------------------------------------------
    # Validation
    # -----------------------------------------------------------------

    @staticmethod
    def _validate_event(event):

        if not isinstance(event, dict):
            raise ValueError("event must be a dict")

        missing = [
            key
            for key in REQUIRED
            if key not in event
        ]

        if missing:
            raise ValueError(
                f"event missing fields: {missing}"
            )

        for key in (
            "src_packets",
            "dst_packets",
            "src_bytes",
            "dst_bytes",
        ):
            _finite_nonnegative(event[key], key)

    # -----------------------------------------------------------------
    # Timing
    # -----------------------------------------------------------------

    @staticmethod
    def _latency_ms(t0):

        return round(
            (time.perf_counter() - t0) * 1000,
            3,
        )


# ---------------------------------------------------------------------
# Convenience function
# ---------------------------------------------------------------------

def score_event(
    event,
    rule_hit=None,
    if_stage=None,
    xgb_stage=None,
    crie_adapter=None,
    alert_context=None,
    enable_remediation=True,
    top_k=3,
):
    """
    Functional entry point.

    Example:

        result = score_event(
            event,
            rule_hit=rule_hit,
            if_stage=if_stage,
            xgb_stage=xgb_stage,
            alert_context={"src_ip": "1.2.3.4"},
        )
    """

    if if_stage is None:
        raise ValueError(
            "if_stage is required; pass the trained "
            "Isolation Forest adapter"
        )

    detector = Detector(
        if_stage=if_stage,
        xgb_stage=xgb_stage,
        crie_adapter=crie_adapter,
        enable_remediation=enable_remediation,
    )

    return detector.score_event(
        event,
        rule_hit=rule_hit,
        alert_context=alert_context,
        top_k=top_k,
    )