"""CRIE (model 2) in the API (build plan R2): loaded once, in the background at start-up.

The engine takes about 13 s to load, so the API starts at once and the endpoint answers 503 until it
is ready. If it fails to load, the API keeps running: the endpoint answers 503 with the reason and
GET /models lists CRIE as `failed`. CRIE only recommends; nothing is ever carried out.
"""
import asyncio
import json
import logging
import os
import time
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("crie")
CACHE_SECONDS = 60
CACHE_MAX = 2000

state = {"status": "pending", "detail": "Loading.", "version": None, "loaded_at": None, "recommend": None,
         "trained_at": None, "metrics": None}
_cache: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()


def _repo_root() -> Path:
    """Where ml/crie lives: CRIE_ROOT, else the first parent folder that has it (/srv in the image)."""
    if os.getenv("CRIE_ROOT"):
        return Path(os.environ["CRIE_ROOT"])
    for p in Path(__file__).resolve().parents:
        if (p / "ml" / "crie" / "engine.py").exists():
            return p
    raise FileNotFoundError("ml/crie/engine.py not found next to the API")


def _bundle_info(engine_dir: Path):
    """Trained date and metrics come from the bundle's own files; absent files read as null."""
    metrics = None
    try:
        metrics = json.loads((engine_dir / "metrics.json").read_text())
    except (OSError, ValueError):
        pass
    trained = None
    card = engine_dir / "model_card.md"
    if card.exists():
        import re
        m = re.search(r"(?i)trained[^0-9]*(\d{4}-\d{2}-\d{2})", card.read_text(errors="ignore"))
        trained = m.group(1) if m else None
    return trained, metrics


def load() -> None:
    """Import and warm the engine (blocking). Sets state to ready or failed; never raises."""
    try:
        import importlib.util
        path = _repo_root() / "ml" / "crie" / "engine.py"
        spec = importlib.util.spec_from_file_location("crie_wrapper", path)
        if spec is None or not path.exists():
            raise FileNotFoundError(f"{path} not found")
        engine = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(engine)
        engine._engine()  # loads crie_model.joblib
        state.update(status="ready", detail=None, version=engine.version(), recommend=engine.recommend,
                     loaded_at=datetime.now(timezone.utc))
        state["trained_at"], state["metrics"] = _bundle_info(engine.ENGINE_DIR)
        log.info("CRIE ready (%s)", state["version"])
    except Exception as e:
        state.update(status="failed", detail=f"CRIE did not load: {type(e).__name__}: {e}"[:300], recommend=None)
        log.error("%s", state["detail"])


def start() -> asyncio.Task:
    return asyncio.create_task(asyncio.to_thread(load))


def model_entry() -> dict:
    """CRIE for GET /models and the `models` message (contracts/LIVE_API.md 4.6)."""
    v = state["version"]
    return {"name": "CRIE", "model_id": v, "version": v.removeprefix("crie-") if v else None,
            "status": state["status"], "trained_at": state["trained_at"], "loaded_at": state["loaded_at"],
            "last_heartbeat_at": None, "detail": state["detail"], "metrics": state["metrics"], "scored_per_sec": None}


def recommend_cached(incident: dict) -> dict:
    """CRIE's answer, unchanged; the same incident and input within 60 s gets the same answer."""
    key = json.dumps(incident, sort_keys=True, default=str)
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and now - hit[0] < CACHE_SECONDS:
        _cache.move_to_end(key)
        return hit[1]
    answer = state["recommend"](incident)
    _cache[key] = (now, answer)
    while len(_cache) > CACHE_MAX:
        _cache.popitem(last=False)
    return answer
