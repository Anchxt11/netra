from abc import ABC, abstractmethod
from typing import Any

class Scorer(ABC):
    @abstractmethod
    def score(self, features: dict[str, Any]) -> float:
        raise NotImplementedError

class DummyScorer(Scorer):
    def score(self, features: dict[str, Any]) -> float:
        score=0.0
        if features.get('is_failure'): score += .15
        if features.get('is_server_error'): score += .15
        if features.get('path_has_admin'): score += .20
        if features.get('process_has_sudo'): score += .25
        if features.get('process_has_useradd'): score += .25
        return min(1.0, round(score,4))

def build_scorer(name='dummy') -> Scorer:
    if name == 'dummy': return DummyScorer()
    raise ValueError(f'Unknown scorer: {name}')
