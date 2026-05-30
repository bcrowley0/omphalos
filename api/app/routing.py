"""Backend symbol router (mirrors the frontend pure function).

Rule (CLAUDE.md): an `X/Y` pair → Kraken; a plain ticker → IBKR. Equity
endpoints (/chart, /quote) only ever receive plain tickers; crypto pairs go
through the dedicated /crypto/{base}/{quote} endpoint (a slash can't pass through
a single path segment).
"""

from __future__ import annotations


def source_for_symbol(symbol: str) -> str:
    return "kraken" if "/" in symbol else "ibkr"
