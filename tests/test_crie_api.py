"""POST /crie/recommend and CRIE in GET /models (build plan R2). Uses the real CRIE engine; needs the
API's and CRIE's pinned packages (api/requirements.txt); skipped otherwise."""
import sys
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("sklearn")
pytest.importorskip("pyarrow")
pytest.importorskip("dill")
pytest.importorskip("asyncpg")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from fastapi.testclient import TestClient  # noqa: E402

from app import crie, db, main, security  # noqa: E402

INCIDENT = {"incident_id": "0131", "attack_type": "brute_force", "mitre_technique": "T1110.001", "severity": 4,
            "detected_by": "rule", "rules": ["brute_force", "suspicious_login"], "model": None,
            "context": {"src_ips": ["172.30.0.10"], "usernames": ["admin@juice-sh.op"], "hosts": ["juice-shop"],
                        "dst_ip": None, "domain": None}}


class NoTablePool:
    async def fetchrow(self, *a):
        import asyncpg
        raise asyncpg.UndefinedTableError("ml_models")


@pytest.fixture(scope="module")
def client():
    db._pool = NoTablePool()
    crie.load()  # what start-up does, here in the foreground
    assert crie.state["status"] == "ready", crie.state["detail"]
    token, _ = security.create_token(2, "analyst", "analyst")
    c = TestClient(main.app)
    c.headers["authorization"] = f"Bearer {token}"
    return c


def test_a_rule_only_incident(client):
    r = client.post("/crie/recommend", json=INCIDENT)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"version", "fixes"} and len(body["fixes"]) == 3
    assert body["version"] == crie.state["version"]


def test_an_incident_with_model_1_output(client):
    m = {**INCIDENT, "detected_by": "both", "model": {"attack_family": "Credential Attack / Brute Force",
         "confidence": 0.93, "is_unknown": False, "if_score": 0.61, "top3": []}}
    body = client.post("/crie/recommend", json=m).json()
    assert len(body["fixes"]) == 3 and all(f["d3fend"]["name"] for f in body["fixes"])


def test_the_fallback(client):
    body = client.post("/crie/recommend", json={**INCIDENT, "mitre_technique": "T9999"}).json()
    assert body == {"version": crie.state["version"], "fallback": {"technique": "T9999", "mitigations": []}}


def test_answers_are_cached_for_60_s(client):
    calls = []
    real = crie.state["recommend"]
    crie.state["recommend"] = lambda inc: calls.append(1) or real(inc)
    try:
        other = {**INCIDENT, "incident_id": "cache-check"}
        a = client.post("/crie/recommend", json=other).json()
        b = client.post("/crie/recommend", json=other).json()
        assert a == b and len(calls) == 1
        client.post("/crie/recommend", json={**other, "severity": 5})  # a changed input is asked again
        assert len(calls) == 2
    finally:
        crie.state["recommend"] = real


def test_signed_in_only_and_input_checked(client):
    assert TestClient(main.app).post("/crie/recommend", json=INCIDENT).status_code == 401
    assert client.post("/crie/recommend", json={**INCIDENT, "severity": 9}).status_code == 422


def test_models_lists_crie_ready(client):
    crie_entry = next(m for m in client.get("/models").json() if m["name"] == "CRIE")
    assert crie_entry["status"] == "ready" and crie_entry["model_id"] == crie.state["version"]


def test_engine_missing_means_503_and_failed(client, monkeypatch, tmp_path):
    saved = dict(crie.state)
    try:
        monkeypatch.setenv("CRIE_ROOT", str(tmp_path))  # no ml/crie there
        crie.load()
        assert crie.state["status"] == "failed" and "did not load" in crie.state["detail"]
        r = client.post("/crie/recommend", json=INCIDENT)
        assert r.status_code == 503 and "did not load" in r.json()["detail"]
        entry = next(m for m in client.get("/models").json() if m["name"] == "CRIE")
        assert entry["status"] == "failed" and "did not load" in entry["detail"]
    finally:
        crie.state.update(saved)
