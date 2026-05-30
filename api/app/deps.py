"""Wire adapters into the registry at import time.

Phase 1: only the MockAdapter. Later phases register real adapters (kraken,
ibkr, fred, news) here; the symbol router / endpoints select among them by name.
"""

from .adapters.mock import MockAdapter
from .adapters.registry import registry

registry.register(MockAdapter())


def get_registry():
    return registry
