"""The backend team's own simulator and rule engine, run together without Docker or Kafka.

Prints one JSON line per enriched event and per alert, exactly as the processor would publish them,
for scripts/live-backend/server.mjs. Frontend testing only: the demo runs the real stack.

    python pipeline.py <backend checkout> [simulator options, e.g. --rate 12 --warmup 15]
"""
import json
import subprocess
import sys
import tempfile
import types
from pathlib import Path

backend = Path(sys.argv[1]).resolve()
sim_args = sys.argv[2:]


def scalar(v):
    v = v.strip()
    if v.startswith('"'):
        return json.loads(v)  # YAML double quotes escape like JSON for these files
    if v.startswith("'"):
        return v[1:-1].replace("''", "'")
    if v in ("true", "false"):
        return v == "true"
    try:
        return int(v)
    except ValueError:
        return v


def mini_yaml(text):
    """Enough YAML for rules/sigma/*.yaml (flat keys, one nested map, simple lists). PyYAML is not needed."""
    lines = [l.rstrip() for l in text.splitlines() if l.strip() and not l.strip().startswith("#")]
    root = {}
    stack = [(-1, root)]
    for i, line in enumerate(lines):
        indent = len(line) - len(line.lstrip())
        s = line.strip()
        while indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]
        if s.startswith("- "):
            parent.append(scalar(s[2:]))
            continue
        key, _, rest = s.partition(":")
        if rest.strip():
            parent[key.strip()] = scalar(rest)
        else:
            nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
            child = [] if nxt.startswith("- ") else {}
            parent[key.strip()] = child
            stack.append((indent, child))
    return root


sys.modules["yaml"] = types.SimpleNamespace(safe_load=mini_yaml)
sys.path.insert(0, str(backend))
from processor.alerts import AlertEmitter  # noqa: E402
from processor.processor import EventProcessor  # noqa: E402
from processor.rule_engine import RuleEngine  # noqa: E402
from processor.scorer import build_scorer  # noqa: E402


def emit(kind, data):
    print(json.dumps({"kind": kind, "data": data}, separators=(",", ":")), flush=True)


class Producer:  # stands in for Kafka: the emitter's alert goes to stdout
    def produce(self, topic, key=None, value=None):
        emit("alert", json.loads(value))


engine = RuleEngine.from_directory(backend / "rules" / "sigma")
emit("rules", [r.id for r in engine.rules])
processor = EventProcessor(engine, build_scorer("dummy"))
alerts = AlertEmitter(Producer(), "alerts")

labels = Path(tempfile.gettempdir()) / "netra-live-backend-labels.jsonl"
sim = subprocess.Popen(
    [sys.executable, "-u", str(backend / "simulator" / "web_traffic_sim.py"), "--dry-run", "--labels", str(labels), *sim_args],
    stdout=subprocess.PIPE,
    text=True,
    bufsize=1,
)
for line in sim.stdout:
    line = line.strip()
    if not line.startswith("{"):
        continue
    event = json.loads(line)
    enriched, hits = processor.process(event)
    emit("event", enriched)
    for hit in hits:
        alerts.emit(hit.rule_id, hit.severity, event)
