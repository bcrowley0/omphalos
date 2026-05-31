"""Wire adapters into the registry at import time.

Real sources are registered as they come online per phase:
- Phase 2: kraken (public), fred
- Phase 3: kraken gains private balances
- Phase 4: rss (news)
- Phase 5: ibkr

The MockAdapter remains registered under "mock" for offline/keyless demos and
tests, but normal routing targets the real sources.
"""

from .adapters.fred import FredAdapter
from .adapters.ibkr import IbkrAdapter
from .adapters.kraken import KrakenAdapter
from .adapters.mock import MockAdapter
from .adapters.people import PeopleAdapter
from .adapters.registry import AdapterRegistry, registry
from .adapters.rss import RssAdapter

registry.register(MockAdapter())
registry.register(KrakenAdapter())
registry.register(FredAdapter())
registry.register(RssAdapter())
registry.register(IbkrAdapter())
registry.register(PeopleAdapter())


def get_registry() -> AdapterRegistry:
    return registry
