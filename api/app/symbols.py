"""Symbol resolver — the name-linking system (single source of truth for routing).

Turns whatever the user types (`btc`, `BTC/USD`, `btcusd`, `aapl`) into a
canonical, broker-routed symbol. Crypto -> Kraken, everything else -> IBKR.
Pure and unit-tested; replaces the old syntactic `source_for_symbol`.
"""

from __future__ import annotations

from dataclasses import dataclass

# Curated crypto base assets (canonical codes). A bare ticker in this set, or a
# glued/slashed form whose base is in this set, routes to Kraken.
CRYPTO_BASES: frozenset[str] = frozenset(
    {
        "BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LTC", "DOT", "LINK",
        "AVAX", "MATIC", "ATOM", "XLM", "BCH", "UNI", "AAVE",
    }
)

# Kraken legacy / alternate input codes folded to a canonical base.
_BASE_INPUT_ALIASES: dict[str, str] = {"XBT": "BTC", "XDG": "DOGE"}

# Known quote currencies, LONGEST FIRST so USDT/USDC beat USD when suffix-splitting.
QUOTE_CCYS: tuple[str, ...] = ("USDT", "USDC", "USD", "EUR", "GBP")

DEFAULT_QUOTE = "USD"


@dataclass(frozen=True)
class Resolved:
    source: str   # "kraken" | "ibkr"
    display: str  # canonical label for the UI, e.g. "BTC/USD" or "AAPL"
    symbol: str   # what the adapter receives (same as display here)


def _canonical_base(base: str) -> str:
    return _BASE_INPUT_ALIASES.get(base, base)


def _kraken(base: str, quote: str) -> Resolved:
    pair = f"{base}/{quote}"
    return Resolved(source="kraken", display=pair, symbol=pair)


def _ibkr(ticker: str) -> Resolved:
    return Resolved(source="ibkr", display=ticker, symbol=ticker)


def resolve(raw: str) -> Resolved:
    """Total: every input returns a Resolved (defaults to IBKR). Never raises."""
    s = raw.strip().upper()

    # 1. Explicit pair "BASE/QUOTE" (unknown base still routes to Kraken).
    if "/" in s:
        base, _, quote = s.partition("/")
        return _kraken(_canonical_base(base), quote or DEFAULT_QUOTE)

    # 2. Glued crypto form "BTCUSD": known crypto base + known quote suffix.
    for q in QUOTE_CCYS:  # longest-first
        if s.endswith(q) and len(s) > len(q):
            base = _canonical_base(s[: -len(q)])
            if base in CRYPTO_BASES:
                return _kraken(base, q)

    # 3. Bare crypto base "BTC" -> default quote.
    if _canonical_base(s) in CRYPTO_BASES:
        return _kraken(_canonical_base(s), DEFAULT_QUOTE)

    # 4. Everything else -> IBKR equity ticker.
    return _ibkr(s)
