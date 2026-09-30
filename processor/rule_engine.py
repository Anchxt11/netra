import re, time
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import yaml

@dataclass(frozen=True)
class Rule:
    id: str; title: str; severity: str; detection: dict[str,Any]; condition: str
    timeframe: int|None=None; count: int|None=None

@dataclass
class RuleHit:
    rule_id: str; severity: str; title: str

def value_at(event, field):
    value=event
    for part in field.split('.'):
        if not isinstance(value,dict): return None
        value=value.get(part)
    return value

def split_modifier(key):
    return key.split('|',1) if '|' in key else (key,'equals')

def match(value, expected, modifier):
    if modifier=='equals': return value==expected
    if modifier=='contains': return str(expected).lower() in str(value or '').lower()
    if modifier=='startswith': return str(value or '').lower().startswith(str(expected).lower())
    if modifier=='endswith': return str(value or '').lower().endswith(str(expected).lower())
    if modifier=='gt': return value is not None and float(value)>float(expected)
    if modifier=='gte': return value is not None and float(value)>=float(expected)
    if modifier=='lt': return value is not None and float(value)<float(expected)
    if modifier=='lte': return value is not None and float(value)<=float(expected)
    if modifier=='in': return value in expected
    if modifier=='regex': return re.search(str(expected),str(value or '')) is not None
    raise ValueError(f'Unsupported modifier: {modifier}')

def detection_match(event,detection):
    return all(match(value_at(event,*split_modifier(k)[:1]),v,split_modifier(k)[1]) for k,v in detection.items())

class RuleEngine:
    def __init__(self,rules):
        self.rules=rules
        self.windows=defaultdict(deque)
    @classmethod
    def from_directory(cls,directory:Path):
        rules=[]
        for path in sorted(directory.glob('*.yaml')):
            raw=yaml.safe_load(path.read_text())
            rules.append(Rule(raw['id'],raw['title'],raw['severity'],raw['detection'],raw['condition'],raw.get('timeframe'),raw.get('count')))
        return cls(rules)
    def evaluate(self,event,now=None):
        now=time.time() if now is None else now
        hits=[]
        for rule in self.rules:
            if not detection_match(event,rule.detection): continue
            if rule.timeframe is not None and rule.count is not None:
                key=(rule.id,str(event.get('ip','-')))
                window=self.windows[key]; window.append(now)
                cutoff=now-rule.timeframe
                while window and window[0]<cutoff: window.popleft()
                if len(window)<rule.count: continue
            hits.append(RuleHit(rule.id,rule.severity,rule.title))
        return hits
