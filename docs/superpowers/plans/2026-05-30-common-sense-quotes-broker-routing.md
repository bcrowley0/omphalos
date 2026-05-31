# Common-sense quotes + broker name-linking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `btc`, `btc/usd`, and `btcusd` all resolve to the same Kraken BTC/USD quote (and `aapl` to an IBKR quote) via one curated backend resolver, and fold the `/crypto` endpoint into unified `/quote` and `/chart` endpoints.

**Architecture:** A new pure backend module `api/app/symbols.py` (the "name-linking system") holds a curated crypto registry and a total `resolve(raw) -> Resolved` function that returns `{source, display, symbol}`. `/quote` and `/chart` take the symbol as a query param (carries a `/` safely), call `resolve`, dispatch to the Kraken/IBKR adapter, and echo the canonical display symbol + source. The frontend deletes its duplicate `routeSymbol` and the `crypto` command/widget; crypto symbols flow through the same `QuoteWidget`/`ChartWidget` as equities.

**Tech Stack:** FastAPI + Pydantic (Python 3.14 venv at `api/.venv`), pytest (`asyncio_mode=auto`); Next.js + TypeScript, Vitest; OpenAPI TS client generated via `openapi-typescript`.

---

## File Structure

**Backend**
- Create `api/app/symbols.py` — registry + `resolve()` (replaces `routing.py`).
- Delete `api/app/routing.py` — old `source_for_symbol`.
- Modify `api/app/routers.py` — `/quote` & `/chart` use query `symbol` + `resolve`; remove `/crypto`.
- Modify `api/app/models.py` — remove `CryptoResponse`.
- Create `api/tests/test_symbols.py` — resolver table tests.
- Create `api/tests/test_market_endpoints.py` — router dispatch tests (fake adapters).
- Delete `api/tests/test_routing.py`.

**Frontend**
- Delete `web/app/lib/command/router.ts` and `web/app/lib/command/router.test.ts`.
- Modify `web/app/lib/command/parser.ts`, `types.ts`, `tabs.ts` — retire `crypto`.
- Modify `web/app/lib/command/parser.test.ts`, `tabs.test.ts`.
- Modify `web/app/lib/loaders.ts` — query-param endpoints; remove `loadCrypto`.
- Delete `web/app/widgets/CryptoWidget.tsx`; modify `web/app/components/WidgetHost.tsx`.
- Modify `web/app/components/CommandBar.tsx`, `web/app/widgets/HelpWidget.tsx`.
- Regenerate `web/app/lib/api/schema.ts`.

---

## Task 1: Backend symbol resolver (the name-linking system)

**Files:**
- Create: `api/app/symbols.py`
- Test: `api/tests/test_symbols.py`

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_symbols.py`:

```python
from app.symbols import Resolved, resolve


def test_bare_crypto_base_defaults_to_usd_on_kraken():
    assert resolve("btc") == Resolved(source="kraken", display="BTC/USD", symbol="BTC/USD")


def test_explicit_pair_routes_to_kraken():
    assert resolve("BTC/USD") == Resolved(source="kraken", display="BTC/USD", symbol="BTC/USD")
    assert resolve("eth/eur") == Resolved(source="kraken", display="ETH/EUR", symbol="ETH/EUR")


def test_glued_crypto_form_is_split():
    assert resolve("btcusd") == Resolved(source="kraken", display="BTC/USD", symbol="BTC/USD")


def test_usdt_suffix_beats_usd():
    # ETHUSDT must split as ETH + USDT, not ETHUS + DT or ETHUSD + T.
    assert resolve("ethusdt") == Resolved(source="kraken", display="ETH/USDT", symbol="ETH/USDT")


def test_kraken_legacy_base_alias_accepted_as_input():
    assert resolve("xbt") == Resolved(source="kraken", display="BTC/USD", symbol="BTC/USD")
    assert resolve("xbtusd") == Resolved(source="kraken", display="BTC/USD", symbol="BTC/USD")


def test_plain_equity_ticker_routes_to_ibkr():
    assert resolve("aapl") == Resolved(source="ibkr", display="AAPL", symbol="AAPL")
    assert resolve("MSFT") == Resolved(source="ibkr", display="MSFT", symbol="MSFT")


def test_bare_quote_currency_falls_through_to_ibkr():
    # "usd" is not a crypto base and has no crypto prefix -> not rerouted to Kraken.
    assert resolve("usd").source == "ibkr"


def test_unknown_base_with_slash_still_routes_to_kraken():
    assert resolve("FOO/USD") == Resolved(source="kraken", display="FOO/USD", symbol="FOO/USD")


def test_whitespace_is_tolerated():
    assert resolve("  btc/usd  ") == Resolved(source="kraken", display="BTC/USD", symbol="BTC/USD")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/brian/omphalos/api && .venv/bin/pytest tests/test_symbols.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.symbols'`.

- [ ] **Step 3: Write minimal implementation**

Create `api/app/symbols.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/brian/omphalos/api && .venv/bin/pytest tests/test_symbols.py -v`
Expected: PASS (9 passed).

- [ ] **Step 5: Commit**

```bash
cd /home/brian/omphalos
git add api/app/symbols.py api/tests/test_symbols.py
git commit -m "feat(api): symbol resolver — curated crypto registry + name-linking

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire resolver into /quote & /chart; remove /crypto

**Files:**
- Modify: `api/app/routers.py:11` (drop `import asyncio`), `:16-46` (imports), `:74-128` (endpoints)
- Modify: `api/app/models.py:166-175` (remove `CryptoResponse`)
- Modify: `api/tests/test_chart_controls.py:13,48-52` (drop `CryptoResponse` import + test)
- Delete: `api/app/routing.py`, `api/tests/test_routing.py`
- Test: `api/tests/test_market_endpoints.py`

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_market_endpoints.py`:

```python
import app.routers as routers
from app.adapters.base import Adapter
from app.models import Candle, Interval, Quote, Span
from fastapi.testclient import TestClient

from app.main import app


class FakeAdapter(Adapter):
    """Records the symbol it was called with and returns canned data."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.quote_calls: list[str] = []
        self.candle_calls: list[str] = []

    async def get_quote(self, symbol: str) -> Quote:
        self.quote_calls.append(symbol)
        return Quote(symbol=symbol, last=1.0, source=self.name)

    async def get_candles(
        self, symbol: str, interval=Interval.D1, span=Span.M1
    ) -> list[Candle]:
        self.candle_calls.append(symbol)
        return [Candle(t=0, o=1, h=1, l=1, c=1, v=1)]


class FakeRegistry:
    def __init__(self) -> None:
        self.kraken = FakeAdapter("kraken")
        self.ibkr = FakeAdapter("ibkr")

    def get(self, name: str):
        return {"kraken": self.kraken, "ibkr": self.ibkr}.get(name)


def _client(monkeypatch) -> tuple[TestClient, FakeRegistry]:
    reg = FakeRegistry()
    monkeypatch.setattr(routers, "get_registry", lambda: reg)
    return TestClient(app), reg


def test_quote_btc_routes_to_kraken_with_canonical_pair(monkeypatch):
    client, reg = _client(monkeypatch)
    r = client.get("/quote", params={"symbol": "btc"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["quote"]["symbol"] == "BTC/USD"
    assert body["quote"]["source"] == "kraken"
    assert reg.kraken.quote_calls == ["BTC/USD"]
    assert reg.ibkr.quote_calls == []


def test_quote_aapl_routes_to_ibkr(monkeypatch):
    client, reg = _client(monkeypatch)
    r = client.get("/quote", params={"symbol": "aapl"})
    assert r.json()["quote"]["source"] == "ibkr"
    assert reg.ibkr.quote_calls == ["AAPL"]


def test_chart_btcusd_routes_to_kraken_and_echoes_canonical(monkeypatch):
    client, reg = _client(monkeypatch)
    r = client.get("/chart", params={"symbol": "btcusd"})
    body = r.json()
    assert body["symbol"] == "BTC/USD"
    assert body["source"] == "kraken"
    assert len(body["candles"]) == 1
    assert reg.kraken.candle_calls == ["BTC/USD"]


def test_crypto_endpoint_is_gone(monkeypatch):
    client, _ = _client(monkeypatch)
    assert client.get("/crypto/BTC/USD").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/brian/omphalos/api && .venv/bin/pytest tests/test_market_endpoints.py -v`
Expected: FAIL — `/quote` & `/chart` 404/422 (still path-param) and `/crypto` still returns 200.

- [ ] **Step 3a: Remove `CryptoResponse` from models and its lone test**

In `api/app/models.py`, delete the entire `CryptoResponse` class (lines 166-175):

```python
class CryptoResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    pair: str
    source: str
    quote: Quote | None = None
    candles: list[Candle] = []
    interval: Interval = Interval.H1
    span: Span = Span.M1
```

`api/tests/test_chart_controls.py` imports `CryptoResponse` and has one test for it — both must go or the file won't collect. In that file:
- Remove `CryptoResponse,` from the `from app.models import (...)` block (line 13).
- Delete the `test_crypto_response_default_pair_is_coherent` test (lines 48-52):

```python
def test_crypto_response_default_pair_is_coherent():
    # The API fallback default pair must be a valid span/interval combo: 1M + 1h.
    resp = CryptoResponse(status=SourceStatus.EMPTY, pair="BTC/USD", source="kraken")
    assert resp.interval == Interval.H1
    assert resp.span == Span.M1
```

The rest of `test_chart_controls.py` tests adapters/enums directly (no HTTP `/chart` or `/crypto` calls), so it needs no further changes.

- [ ] **Step 3b: Rewrite the market endpoints in `api/app/routers.py`**

Remove `import asyncio` (line 11). In the `from .models import (...)` block remove `CryptoResponse`. Replace the import line `from .routing import source_for_symbol` with `from .symbols import resolve`. Then replace the entire chart/quote/crypto section (current lines 71-128) with:

```python
# --------------------------------------------------------------------------- #
# chart / quote — symbol resolved to a broker by the name-linking resolver.
# Symbol is a query param so a crypto pair's "/" passes through safely.
# --------------------------------------------------------------------------- #
@router.get("/chart", response_model=CandlesResponse, tags=["market"])
async def chart(symbol: str = Query(...), interval: str = "1d") -> CandlesResponse:
    r = resolve(symbol)
    adapter = _adapter(r.source)
    if adapter is None:
        return CandlesResponse(
            status=SourceStatus.SOURCE_DOWN,
            message=f"{r.source} integration not available.",
            symbol=r.display, source=r.source,
        )
    try:
        candles = await adapter.get_candles(r.symbol, interval=interval)
    except Exception as exc:  # noqa: BLE001 - mapped to a UI state, never crashes
        status, msg = _status_from_exc(exc)
        return CandlesResponse(status=status, message=msg, symbol=r.display, source=r.source)
    status = SourceStatus.OK if candles else SourceStatus.EMPTY
    return CandlesResponse(status=status, symbol=r.display, source=r.source, candles=candles)


@router.get("/quote", response_model=QuoteResponse, tags=["market"])
async def quote(symbol: str = Query(...)) -> QuoteResponse:
    r = resolve(symbol)
    adapter = _adapter(r.source)
    if adapter is None:
        return QuoteResponse(
            status=SourceStatus.SOURCE_DOWN,
            message=f"{r.source} integration not available.",
        )
    try:
        q: Quote = await adapter.get_quote(r.symbol)
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return QuoteResponse(status=status, message=msg)
    return QuoteResponse(status=SourceStatus.OK, quote=q)
```

Note: the old `/crypto/{base}/{quote_ccy}` endpoint is deleted entirely (not replaced).

- [ ] **Step 3c: Delete the obsolete router + its test**

```bash
cd /home/brian/omphalos
git rm api/app/routing.py api/tests/test_routing.py
```

- [ ] **Step 4: Run the full backend suite**

Run: `cd /home/brian/omphalos/api && .venv/bin/pytest -v`
Expected: PASS. `test_market_endpoints.py` green; no import errors from the deleted `routing` module; `test_chart_controls.py` still green after the Step 3a edits.

- [ ] **Step 5: Commit**

```bash
cd /home/brian/omphalos
git add api/app/routers.py api/app/models.py api/tests/test_market_endpoints.py
git commit -m "feat(api): unify /quote & /chart via resolver; remove /crypto

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Regenerate the OpenAPI TypeScript client

**Files:**
- Modify: `web/app/lib/api/schema.ts` (generated)

- [ ] **Step 1: Start the backend**

Run (background): `cd /home/brian/omphalos/api && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`
Expected: log line `Uvicorn running on http://127.0.0.1:8000`.

- [ ] **Step 2: Verify the new schema is live**

Run: `curl -s http://127.0.0.1:8000/openapi.json | python -c "import sys,json; p=json.load(sys.stdin)['paths']; print('quote' in str(p)); assert '/crypto/{base}/{quote_ccy}' not in p; print(sorted(k for k in p if 'quote' in k or 'chart' in k))"`
Expected: prints `True` and `['/chart', '/quote']`; no assertion error.

- [ ] **Step 3: Regenerate the client**

Run: `cd /home/brian/omphalos/web && npm run gen:api`
Expected: writes `app/lib/api/schema.ts`; the `/crypto/{base}/{quote_ccy}` path and `CryptoResponse` schema are gone, `/quote` & `/chart` carry a `symbol` query param.

- [ ] **Step 4: Stop the backend**

Stop the background uvicorn process.

- [ ] **Step 5: Commit**

```bash
cd /home/brian/omphalos
git add web/app/lib/api/schema.ts
git commit -m "chore(web): regenerate OpenAPI client (unified quote/chart, no crypto)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> Note: after this commit the TS build is temporarily red (loaders/widgets still reference the old client). It goes green again at Task 6. Vitest (Tasks 4) does not full-typecheck, so its tests still pass meanwhile.

---

## Task 4: Frontend grammar — retire the `crypto` command

**Files:**
- Modify: `web/app/lib/command/parser.ts:27-30`, `web/app/lib/command/types.ts:3-46`, `web/app/lib/command/tabs.ts:14-15`
- Modify: `web/app/lib/command/parser.test.ts`, `web/app/lib/command/tabs.test.ts`
- Delete: `web/app/lib/command/router.ts`, `web/app/lib/command/router.test.ts`

- [ ] **Step 1: Update the tests first (they encode the new grammar)**

In `web/app/lib/command/parser.test.ts`, **replace** the two crypto tests (the `parses \`crypto BTC/USD\`` test at lines 25-27 and the `returns an error when \`crypto\` is missing its pair` test at lines 55-57) with:

```typescript
  it("parses `quote BTC/USD` keeping the slashed pair (upper-cased)", () => {
    expect(parseCommand("quote btc/usd")).toEqual({ kind: "quote", symbol: "BTC/USD" });
  });

  it("parses `chart btcusd` (resolver handles crypto routing server-side)", () => {
    expect(parseCommand("chart btcusd")).toEqual({ kind: "chart", symbol: "BTCUSD" });
  });

  it("treats the retired `crypto` verb as unknown", () => {
    const r = parseCommand("crypto BTC/USD");
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/unknown/i);
  });
```

In `web/app/lib/command/tabs.test.ts`, **replace** the first test (lines 8-12) with one that no longer references crypto:

```typescript
  it("maps chart/quote to per-symbol tabs with stable dedup ids", () => {
    expect(tabFor("chart AAPL")).toMatchObject({ id: "chart:AAPL", widget: "chart", symbol: "AAPL" });
    expect(tabFor("quote MSFT")).toMatchObject({ id: "quote:MSFT", widget: "quote", symbol: "MSFT" });
    expect(tabFor("quote BTC/USD")).toMatchObject({ id: "quote:BTC/USD", widget: "quote", symbol: "BTC/USD" });
  });
```

- [ ] **Step 2: Delete the obsolete frontend router + its test**

```bash
cd /home/brian/omphalos
git rm web/app/lib/command/router.ts web/app/lib/command/router.test.ts
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /home/brian/omphalos/web && npm run test`
Expected: FAIL — parser still returns a `crypto` command (so the "unknown verb" test fails); tabs may still compile but the `Source` import in `loaders.ts` is now broken. (Failures are expected at this step.)

- [ ] **Step 4: Update parser, types, and tabs**

In `web/app/lib/command/parser.ts`, delete the `crypto` case (lines 27-30):

```typescript
    case "crypto": {
      if (args.length === 0) return err(input, "Usage: crypto <PAIR>, e.g. crypto BTC/USD");
      return { kind: "crypto", pair: args[0].toUpperCase() };
    }
```

In `web/app/lib/command/types.ts`:
- Remove the line `  | { kind: "crypto"; pair: string }` from the `Command` union.
- Delete the `Source` type (lines 19-20: the comment + `export type Source = "ibkr" | "kraken";`).
- Remove `"crypto"` from the `WidgetKind` union.
- Remove the `pair?: string;` field from `Tab`.

In `web/app/lib/command/tabs.ts`, delete the `crypto` case (lines 14-15):

```typescript
    case "crypto":
      return { id: `crypto:${cmd.pair}`, widget: "crypto", title: cmd.pair, pair: cmd.pair };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /home/brian/omphalos/web && npm run test`
Expected: PASS for `parser.test.ts` and `tabs.test.ts`. (`store.test.ts` unaffected.)

- [ ] **Step 6: Commit**

```bash
cd /home/brian/omphalos
git add web/app/lib/command/
git commit -m "feat(web): retire crypto command; delete duplicate routeSymbol

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend loaders — unified query-param endpoints

**Files:**
- Modify: `web/app/lib/loaders.ts:1-37` (imports + loadChart/loadQuote/loadCrypto), `:76-109` (loadChartData/loadQuoteData)

- [ ] **Step 1: Update imports**

In `web/app/lib/loaders.ts`, remove the `routeSymbol` import (line 3: `import { routeSymbol } from "./command/router";`). Keep the `Person` type import.

- [ ] **Step 2: Switch loadChart/loadQuote to query params and remove loadCrypto**

Replace `loadChart` and `loadQuote` (lines 21-29):

```typescript
export async function loadChart(symbol: string): Promise<Schemas["CandlesResponse"]> {
  const { data, error } = await api.GET("/chart", { params: { query: { symbol } } });
  return unwrap(data, error);
}

export async function loadQuote(symbol: string): Promise<Schemas["QuoteResponse"]> {
  const { data, error } = await api.GET("/quote", { params: { query: { symbol } } });
  return unwrap(data, error);
}
```

Delete `loadCrypto` entirely (lines 31-37):

```typescript
export async function loadCrypto(pair: string): Promise<Schemas["CryptoResponse"]> {
  const [base, quoteCcy] = pair.split("/");
  const { data, error } = await api.GET("/crypto/{base}/{quote_ccy}", {
    params: { path: { base, quote_ccy: quoteCcy } },
  });
  return unwrap(data, error);
}
```

- [ ] **Step 3: Simplify loadChartData/loadQuoteData (backend now routes)**

Replace the unified loaders (lines 76-109) with:

```typescript
// Unified chart/quote loaders. The backend resolver decides Kraken vs IBKR from
// the raw symbol (btc, btc/usd, btcusd, aapl, ...), so the frontend just passes
// the symbol through. Both normalize to a common shape so widgets stay
// source-agnostic.
export type ChartData = {
  status: Schemas["SourceStatus"];
  message?: string | null;
  source: string;
  candles: Schemas["Candle"][];
};

export async function loadChartData(symbol: string): Promise<ChartData> {
  const r = await loadChart(symbol);
  return { status: r.status, message: r.message, source: r.source, candles: r.candles };
}

export type QuoteData = {
  status: Schemas["SourceStatus"];
  message?: string | null;
  quote: Schemas["Quote"] | null | undefined;
};

export async function loadQuoteData(symbol: string): Promise<QuoteData> {
  const r = await loadQuote(symbol);
  return { status: r.status, message: r.message, quote: r.quote };
}
```

(Leave `loadWatchlist` below unchanged — it still maps over `loadQuoteData`.)

- [ ] **Step 4: Typecheck the loaders against the regenerated client**

Run: `cd /home/brian/omphalos/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "loaders\.ts" || echo "loaders OK"`
Expected: `loaders OK` (no type errors in `loaders.ts`). Other files (CryptoWidget/WidgetHost) may still error — fixed in Task 6.

- [ ] **Step 5: Commit**

```bash
cd /home/brian/omphalos
git add web/app/lib/loaders.ts
git commit -m "feat(web): loaders call unified /quote & /chart; drop loadCrypto

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend widgets & command UI cleanup

**Files:**
- Delete: `web/app/widgets/CryptoWidget.tsx`
- Modify: `web/app/components/WidgetHost.tsx:6,24-25`, `web/app/components/CommandBar.tsx:18`, `web/app/widgets/HelpWidget.tsx:4-10`

- [ ] **Step 1: Delete CryptoWidget and unwire it from WidgetHost**

```bash
cd /home/brian/omphalos
git rm web/app/widgets/CryptoWidget.tsx
```

In `web/app/components/WidgetHost.tsx`, remove the import (line 6: `import CryptoWidget from "../widgets/CryptoWidget";`) and the case (lines 24-25):

```typescript
    case "crypto":
      return <CryptoWidget pair={tab.pair!} />;
```

- [ ] **Step 2: Update the command-bar suggestions**

In `web/app/components/CommandBar.tsx`, delete the `crypto` suggestion (line 18) and update the `chart`/`quote` hints (lines 16-17) to:

```typescript
  { verb: "chart", label: "chart <SYMBOL>", hint: "price chart — equities or crypto (btc, btc/usd)", needsArg: true },
  { verb: "quote", label: "quote <SYMBOL>", hint: "snapshot quote — equities or crypto", needsArg: true },
```

- [ ] **Step 3: Update the help list**

In `web/app/widgets/HelpWidget.tsx`, delete the `crypto <PAIR>` row (line 10) and update the chart/quote rows (lines 4-5) to:

```typescript
  ["chart <SYMBOL>", "Price chart — equities (AAPL) or crypto (btc, btc/usd, btcusd)"],
  ["quote <SYMBOL>", "Snapshot quote — equities or crypto; same symbol forms"],
```

- [ ] **Step 4: Full typecheck, lint, build, and tests**

Run: `cd /home/brian/omphalos/web && npx tsc --noEmit && npm run lint && npm run test && npm run build`
Expected: all PASS — no references to `CryptoWidget`, `loadCrypto`, `routeSymbol`, `Source`, `CryptoResponse`, or `tab.pair` remain.

- [ ] **Step 5: Commit**

```bash
cd /home/brian/omphalos
git add web/app/components/WidgetHost.tsx web/app/components/CommandBar.tsx web/app/widgets/HelpWidget.tsx
git commit -m "feat(web): remove CryptoWidget; quote/chart serve crypto via resolver

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full-stack verification

**Files:** none (verification only)

- [ ] **Step 1: Backend suite**

Run: `cd /home/brian/omphalos/api && .venv/bin/pytest -v`
Expected: all PASS, including `test_symbols.py` and `test_market_endpoints.py`; no `routing` import errors.

- [ ] **Step 2: Frontend suite + build**

Run: `cd /home/brian/omphalos/web && npm run test && npm run build`
Expected: all PASS.

- [ ] **Step 3: Manual smoke (optional, requires keys/gateway)**

Start backend + frontend, then in the command bar try: `quote btc`, `quote btc/usd`, `quote btcusd` (all show `BTC/USD`, source `kraken`), and `quote aapl` (source `ibkr`). Confirm `crypto BTC/USD` now shows an inline "Unknown command" error.

- [ ] **Step 4: Confirm no stale references remain**

Run: `cd /home/brian/omphalos && grep -rn "routeSymbol\|loadCrypto\|CryptoResponse\|CryptoWidget\|source_for_symbol\|\.routing import" api/app web/app --include=*.py --include=*.ts --include=*.tsx | grep -v schema.ts || echo "clean"`
Expected: `clean`.
