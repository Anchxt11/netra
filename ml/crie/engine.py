"""CRIE (model 2) behind the R0 contract (frontend/docs/BUILD_PLAN.md, section R0).

    from ml.crie.engine import recommend
    recommend(incident) -> {"version", "fixes": [...3]} or {"version", "fallback": {...}}

A thin wrapper: it imports the ML team's own engine (model_2_temp/crie_deployment/crie_engine.py,
which loads crie_model.joblib once) and changes nothing in it. It only translates our incident
into the engine's call and the engine's answer into R0's output.

CRIE ONLY RECOMMENDS. Nothing here, or in the engine, carries out an action: the answer is a list
for an analyst, who approves or rejects it, and a person does the fix.

Not the ML team's final version: the files have no VERSION, model_card.md, metrics.json or
samples.jsonl yet, so the version names the artifact by its hash, and nothing can be checked
against the notebook's own output.
"""
import csv
import hashlib
import importlib.util
import json
import re
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENGINE_DIR = ROOT / "model_2_temp" / "crie_deployment"
KNOWLEDGE_DIR = ROOT / "model_2_temp"

# Our severity 1..5 (contracts: low 2, medium 3, high 4, critical 5) in the engine's words.
SEVERITY = {1: "info", 2: "low", 3: "medium", 4: "high", 5: "critical"}


@lru_cache(maxsize=1)
def _engine():
    spec = importlib.util.spec_from_file_location("crie_engine", ENGINE_DIR / "crie_engine.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # loads crie_model.joblib, once
    return mod


@lru_cache(maxsize=1)
def version() -> str:
    v = ENGINE_DIR / "VERSION"
    if v.exists():
        return f"crie-{v.read_text().strip()}"
    digest = hashlib.sha256((ENGINE_DIR / "crie_model.joblib").read_bytes()).hexdigest()[:8]
    return f"crie-unversioned-{digest}"  # no VERSION file handed over yet


@lru_cache(maxsize=1)
def _d3fend() -> dict[str, dict]:
    """action_id -> the D3FEND technique it maps to (a direct mapping first), with its D3FEND id."""
    ids = {t["label"]: t["id"] for t in json.loads((KNOWLEDGE_DIR / "d3fend_techniques.json").read_text(encoding="utf-8"))}
    best: dict[str, tuple[int, str]] = {}
    with open(KNOWLEDGE_DIR / "d3fend_action_mapping.csv", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rank = 0 if row["mapping_strength"] == "direct" else 1
            if row["action_id"] not in best or rank < best[row["action_id"]][0]:
                best[row["action_id"]] = (rank, row["d3fend_technique"])
    return {a: {"id": ids.get(name), "name": name} for a, (_, name) in best.items()}


def _first(values):
    for v in values or []:
        if v not in (None, "", "-"):
            return v
    return None


def _technique(incident: dict, e) -> str | None:
    """The incident's own MITRE technique (or its parent, if CRIE knows only that); else, when model 1
    named a family, the family's first ATT&CK technique."""
    t = incident.get("mitre_technique")
    if t:
        if t in e.technique_to_index:
            return t
        parent = t.split(".")[0]
        if parent in e.technique_to_index:
            return parent
        return t  # unknown to CRIE: the engine answers with its fallback
    m = incident.get("model") or {}
    if m.get("attack_family") and not m.get("is_unknown"):
        return e.family_to_attack_technique(e.normalize_attack_family(m["attack_family"]))["technique_id"]
    return None


def recommend(incident: dict) -> dict:
    """R0 input -> R0 output. Never raises for a well-formed incident; never carries anything out."""
    e = _engine()
    ctx = incident.get("context") or {}
    model = incident.get("model")
    severity = SEVERITY.get(int(incident.get("severity") or 3), "medium")
    technique = _technique(incident, e)
    if technique is None:
        return {"version": version(), "fallback": {"technique": None, "mitigations": []}}
    result = e.final_crie_inference(
        technique_id=technique,
        severity=severity,
        confidence=float(model["confidence"]) if model and model.get("confidence") is not None else 1.0,
        alert_context={
            "src_ip": _first(ctx.get("src_ips")),
            "username": _first(ctx.get("usernames")),
            "host": _first(ctx.get("hosts")),
            "dst_ip": ctx.get("dst_ip"),
            "domain": ctx.get("domain"),
        },
        top_k=3,
    )
    recs = result.get("recommendations") or []
    if result.get("fallback_used") or not recs:
        return {"version": version(), "fallback": {
            "technique": re.sub(r"\..*$", "", technique),
            # CRIE's files have no technique -> MITRE mitigation table (build_knowledge.py builds it from the
            # ATT&CK bundle, which was not handed over), so it names the technique and the dashboard lists
            # MITRE's mitigations for it from its own table.
            "mitigations": [],
        }}
    w_ev, w_ml = float(e.CRIE_EVIDENCE_WEIGHT), float(e.CRIE_ML_WEIGHT)
    d3 = _d3fend()
    fixes = [{
        "action_id": r["action_id"],
        "name": r["label"],
        "d3fend": d3.get(r["action_id"], {"id": None, "name": None}),
        "confidence": r["score"],  # CRIE's hybrid score: 0.75 x knowledge-base evidence + 0.25 x ML probability
        "rank": r["rank"],
        "reasons": [
            {"feature": "knowledge_base_evidence", "value": r["evidence_score"], "contribution": round(w_ev * r["evidence_score"], 4)},
            {"feature": "ml_probability", "value": r["ml_probability"], "contribution": round(w_ml * r["ml_probability"], 4)},
        ],
        "provenance": r["provenance"],
    } for r in recs]
    return {"version": version(), "fixes": fixes}
