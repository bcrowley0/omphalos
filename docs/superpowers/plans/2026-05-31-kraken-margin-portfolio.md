# Kraken Margin Positions + Margin Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Kraken open margin positions (merged into the portfolio positions table) and an account-level margin summary panel, all read-only.

**Architecture:** Two new signed Kraken endpoints (`OpenPositions`, `TradeBalance`) reusing the existing HMAC-SHA512 signing + nonce infra. Pure parser functions normalize each to canonical shapes. The `/portfolio` route gains two independent per-source calls; margin positions append into `positions[]`, the summary becomes a new `margin_summary` field. Frontend renders two new columns + a summary panel; TS types regenerate from OpenAPI.

**Tech Stack:** FastAPI / Pydantic (Python 3.14), pytest; Next.js + TypeScript, vitest, openapi-typescript.

**Reference docs to consult during implementation:**
- `.claude/rules/kraken.md` — read before editing the adapter.
- Kraken REST docs for `OpenPositions` (field codes: `pair`, `type`, `vol`, `cost`, `margin`, `value`, `net`; requires `docalcs=true`) and `TradeBalance` (`e`, `m`, `mf`, `ml`, `n`, `c`, `v`). **Verify field semantics against the official docs — do not guess.**
- Spec: `docs/superpowers/specs/2026-05-31-kraken-margin-portfolio-design.md`

**Conventions in this codebase (already verified):**
- Models inherit `CamelModel` (snake_case Python ↔ camelCase wire). New fields with `None` default serialize fine.
- Pure parser functions live at module level in `api/app/adapters/kraken.py` and are unit-tested directly; adapter *methods* (network) are thin wrappers and are not separately network-tested.
- Run backend tests from `api/`: `python -m pytest`. Run a single test: `python -m pytest tests/test_kraken.py::test_name -v`.
- Run frontend checks from `web/`: `npm run test`, `npx tsc --noEmit`, `npm run build`.

---

## File Structure

- **Modify** `api/app/models.py` — extend `Position`, add `MarginSummary`, extend `PortfolioResponse`.
- **Modify** `api/app/adapters/kraken.py` — add `normalize_pair`, `parse_open_positions`, `parse_trade_balance`, and adapter methods `get_open_positions`, `get_trade_balance`.
- **Modify** `api/app/routers.py:140-185` — wire the two new Kraken calls into `/portfolio`.
- **Modify** `web/app/widgets/PortfolioWidget.tsx` — Side/Margin columns + Margin Summary panel.
- **Regenerate** `web/app/lib/api/schema.ts` via `npm run gen:api`.
- **Test files:** `api/tests/test_kraken.py` (parsers), `api/tests/test_routers.py` (route).

---

## Task 1: Extend the data model

**Files:**
- Modify: `api/app/models.py:115-121` (Position), `:178-183` (PortfolioResponse)
- Test: `api/tests/test_kraken.py`

- [ ] **Step 1: Write the failing test**

Add to `api/tests/test_kraken.py`:

```python
from app.models import MarginSummary, Position, PortfolioResponse


def test_position_margin_fields_default_to_none():
    p = Position(symbol="AAPL", qty=1, avg_cost=1, market_value=1, unrealized_pnl=0, source="ibkr")
    assert p.side is None
    assert p.margin_used is None


def test_margin_summary_serializes_camelcase():
    ms = MarginSummary(
        equity=1000.0, used_margin=200.0, free_margin=800.0, margin_level=500.0,
        unrealized_pnl=10.0, cost_basis=190.0, valuation=200.0,
    )
    dumped = ms.model_dump(by_alias=True)
    assert dumped["usedMargin"] == 200.0
    assert dumped["marginLevel"] == 500.0
    assert dumped["source"] == "kraken"


def test_portfolio_response_has_margin_summary_default_none():
    r = PortfolioResponse(status="ok")
    assert r.margin_summary is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_kraken.py::test_margin_summary_serializes_camelcase -v`
Expected: FAIL with `ImportError: cannot import name 'MarginSummary'`

- [ ] **Step 3: Write minimal implementation**

In `api/app/models.py`, replace the `Position` class (lines 115-121) with:

```python
class Position(CamelModel):
    symbol: str
    qty: float
    avg_cost: float
    market_value: float
    unrealized_pnl: float
    source: str
    side: str | None = None  # "long" | "short" — Kraken margin only
    margin_used: float | None = None  # margin committed to this position
```

Add a new `MarginSummary` class immediately after `Balance` (after line 128):

```python
class MarginSummary(CamelModel):
    equity: float  # e  = trade balance + unrealized P&L
    used_margin: float  # m  = margin of open positions
    free_margin: float  # mf = equity - initial margin
    margin_level: float | None = None  # ml = (equity/initial margin)*100; None when no positions
    unrealized_pnl: float  # n
    cost_basis: float  # c
    valuation: float  # v  = floating valuation of open positions
    source: str = "kraken"
```

Extend `PortfolioResponse` (lines 178-183) by adding the margin_summary field:

```python
class PortfolioResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    positions: list[Position] = []
    balances: list[Balance] = []
    margin_summary: MarginSummary | None = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_kraken.py -k "margin or position_margin or portfolio_response" -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add api/app/models.py api/tests/test_kraken.py
git commit -m "feat(models): add Kraken margin fields to Position + MarginSummary"
```

---

## Task 2: `normalize_pair` helper

Kraken's `OpenPositions` returns Kraken pair names like `XXBTZUSD`. Convert to canonical `BASE/QUOTE` (e.g. `BTC/USD`) reusing `normalize_asset`. Strategy: try to split the pair into two halves. Kraken legacy pairs concatenate two asset codes; the robust approach is to try known quote suffixes (`ZUSD`, `ZEUR`, `USD`, `EUR`, `USDT`, `ZGBP`, `XXBT`, `ZJPY`) and split there, normalizing each half. Fall back to the raw pair if no split is found so a row is never dropped.

**Files:**
- Modify: `api/app/adapters/kraken.py` (add after `krakenize_pair`, ~line 109)
- Test: `api/tests/test_kraken.py`

- [ ] **Step 1: Write the failing test**

Add to `api/tests/test_kraken.py`:

```python
from app.adapters.kraken import normalize_pair


def test_normalize_pair_legacy_codes():
    assert normalize_pair("XXBTZUSD") == "BTC/USD"
    assert normalize_pair("XETHZUSD") == "ETH/USD"


def test_normalize_pair_modern_codes():
    assert normalize_pair("USDTUSD") == "USDT/USD"


def test_normalize_pair_unmappable_falls_back_to_raw():
    assert normalize_pair("WEIRDXYZ") == "WEIRDXYZ"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_kraken.py::test_normalize_pair_legacy_codes -v`
Expected: FAIL with `ImportError: cannot import name 'normalize_pair'`

- [ ] **Step 3: Write minimal implementation**

In `api/app/adapters/kraken.py`, add after `krakenize_pair` (after line 109):

```python
# Known quote suffixes in Kraken pair names, longest first so e.g. ZUSD wins
# over a bare USD match. Each is matched against the END of the pair string.
_QUOTE_SUFFIXES = ("ZUSD", "ZEUR", "ZGBP", "ZJPY", "ZCAD", "USDT", "USDC", "USD", "EUR", "GBP", "JPY")


def normalize_pair(pair: str) -> str:
    """Kraken pair name (`XXBTZUSD`) -> canonical `BTC/USD`. Pure/testable.

    Splits on a known quote suffix, normalizes both halves via normalize_asset.
    Falls back to the raw pair if no known suffix matches (never drops a row).
    """
    p = pair.upper()
    for suffix in _QUOTE_SUFFIXES:
        if p.endswith(suffix) and len(p) > len(suffix):
            base = normalize_asset(p[: -len(suffix)])
            quote = normalize_asset(suffix)
            return f"{base}/{quote}"
    return pair
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_kraken.py -k normalize_pair -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/kraken.py api/tests/test_kraken.py
git commit -m "feat(kraken): add normalize_pair for legacy pair codes"
```

---

## Task 3: `parse_open_positions`

**Files:**
- Modify: `api/app/adapters/kraken.py` (add after `parse_balances`, ~line 102)
- Test: `api/tests/test_kraken.py`

- [ ] **Step 1: Write the failing test**

Add to `api/tests/test_kraken.py`:

```python
from app.adapters.kraken import parse_open_positions


def test_parse_open_positions_maps_fields_and_side():
    payload = {
        "error": [],
        "result": {
            "TX1": {
                "pair": "XXBTZUSD", "type": "buy", "vol": "0.5",
                "cost": "20000.0", "margin": "4000.0", "value": "21000.0", "net": "1000.0",
            },
            "TX2": {
                "pair": "XETHZUSD", "type": "sell", "vol": "2.0",
                "cost": "6000.0", "margin": "1200.0", "value": "5800.0", "net": "200.0",
            },
        },
    }
    by_symbol = {p.symbol: p for p in parse_open_positions(payload)}
    assert set(by_symbol) == {"BTC/USD", "ETH/USD"}
    btc = by_symbol["BTC/USD"]
    assert btc.side == "long"
    assert btc.qty == 0.5
    assert btc.avg_cost == 40000.0  # cost / vol
    assert btc.market_value == 21000.0
    assert btc.unrealized_pnl == 1000.0
    assert btc.margin_used == 4000.0
    assert btc.source == "kraken"
    assert by_symbol["ETH/USD"].side == "short"


def test_parse_open_positions_empty_result_is_empty_list():
    assert parse_open_positions({"error": [], "result": {}}) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_kraken.py::test_parse_open_positions_maps_fields_and_side -v`
Expected: FAIL with `ImportError: cannot import name 'parse_open_positions'`

- [ ] **Step 3: Write minimal implementation**

In `api/app/adapters/kraken.py`, add after `parse_balances` (after line 102). Note: import `Position` and `MarginSummary` — update the models import at the top (line 22) to include them:

```python
from ..models import Balance, Candle, Interval, INTERVAL_MS, MarginSummary, Position, Quote, Span, SPAN_MS
```

Then add:

```python
def parse_open_positions(payload: dict[str, Any]) -> list[Position]:
    """Pure: Kraken OpenPositions payload (docalcs=true) -> canonical Positions.

    Result is { txid: {pair, type, vol, cost, margin, value, net}, ... }.
    `type` buy->long, sell->short. avg_cost is per-unit (cost/vol).
    """
    result = payload.get("result") or {}
    out: list[Position] = []
    for info in result.values():
        vol = float(info.get("vol", 0) or 0)
        cost = float(info.get("cost", 0) or 0)
        out.append(
            Position(
                symbol=normalize_pair(str(info.get("pair", ""))),
                side="long" if info.get("type") == "buy" else "short",
                qty=vol,
                avg_cost=(cost / vol) if vol else 0.0,
                market_value=float(info.get("value", 0) or 0),
                unrealized_pnl=float(info.get("net", 0) or 0),
                margin_used=float(info.get("margin", 0) or 0),
                source="kraken",
            )
        )
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_kraken.py -k open_positions -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/kraken.py api/tests/test_kraken.py
git commit -m "feat(kraken): parse OpenPositions into canonical Position shape"
```

---

## Task 4: `parse_trade_balance`

**Files:**
- Modify: `api/app/adapters/kraken.py` (add after `parse_open_positions`)
- Test: `api/tests/test_kraken.py`

- [ ] **Step 1: Write the failing test**

Add to `api/tests/test_kraken.py`:

```python
from app.adapters.kraken import parse_trade_balance


def test_parse_trade_balance_maps_field_codes():
    payload = {
        "error": [],
        "result": {
            "e": "10000.0", "m": "2000.0", "mf": "8000.0", "ml": "500.0",
            "n": "150.0", "c": "1900.0", "v": "2050.0",
        },
    }
    ms = parse_trade_balance(payload)
    assert ms.equity == 10000.0
    assert ms.used_margin == 2000.0
    assert ms.free_margin == 8000.0
    assert ms.margin_level == 500.0
    assert ms.unrealized_pnl == 150.0
    assert ms.cost_basis == 1900.0
    assert ms.valuation == 2050.0
    assert ms.source == "kraken"


def test_parse_trade_balance_missing_ml_is_none():
    payload = {"error": [], "result": {"e": "100.0", "m": "0.0", "mf": "100.0", "n": "0.0", "c": "0.0", "v": "0.0"}}
    assert parse_trade_balance(payload).margin_level is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_kraken.py::test_parse_trade_balance_maps_field_codes -v`
Expected: FAIL with `ImportError: cannot import name 'parse_trade_balance'`

- [ ] **Step 3: Write minimal implementation**

In `api/app/adapters/kraken.py`, add after `parse_open_positions`:

```python
def parse_trade_balance(payload: dict[str, Any]) -> MarginSummary:
    """Pure: Kraken TradeBalance payload -> canonical MarginSummary.

    Field codes: e=equity, m=used margin, mf=free margin, ml=margin level %
    (absent when no open positions), n=unrealized P&L, c=cost basis, v=valuation.
    """
    r = payload.get("result") or {}
    ml = r.get("ml")
    return MarginSummary(
        equity=float(r.get("e", 0) or 0),
        used_margin=float(r.get("m", 0) or 0),
        free_margin=float(r.get("mf", 0) or 0),
        margin_level=float(ml) if ml is not None else None,
        unrealized_pnl=float(r.get("n", 0) or 0),
        cost_basis=float(r.get("c", 0) or 0),
        valuation=float(r.get("v", 0) or 0),
        source="kraken",
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_kraken.py -k trade_balance -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/kraken.py api/tests/test_kraken.py
git commit -m "feat(kraken): parse TradeBalance into MarginSummary"
```

---

## Task 5: Kraken adapter methods (signed network calls)

Thin signed wrappers mirroring `get_balances` (lines 222-243). These are not separately network-tested (the same pattern as `get_balances`); the parsers above carry the logic. Refactor the shared signing boilerplate into a private helper to stay DRY.

**Files:**
- Modify: `api/app/adapters/kraken.py:222-243` (KrakenAdapter)

- [ ] **Step 1: Add a shared signed-POST helper and two methods**

In `api/app/adapters/kraken.py`, inside `class KrakenAdapter`, replace `get_balances` (lines 222-243) with a refactored version plus the two new methods:

```python
    # -- private (signed) -------------------------------------------------- #
    async def _signed_post(self, path: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        settings = get_settings()
        key, secret = settings.kraken_api_key, settings.kraken_api_secret
        if not key or not secret:
            raise Unauthenticated("Kraken API key/secret not set in api/.env")

        data: dict[str, Any] = {"nonce": _nonce.next()}
        if extra:
            data.update(extra)
        try:
            api_sign = sign_request(path, data, secret)
        except (ValueError, binascii.Error) as exc:  # malformed secret
            raise Unauthenticated("Kraken API secret is not valid base64") from exc

        # Signed POST with a per-call nonce — never cached (a nonce is single-use).
        payload = await post_form(
            f"{_API_ROOT}{path}",
            source="kraken",
            data=data,
            headers={"API-Key": key, "API-Sign": api_sign},
        )
        self._raise_for_private_error(payload)
        return payload

    async def get_balances(self) -> list[Balance]:
        payload = await self._signed_post("/0/private/BalanceEx")
        return parse_balances(payload)

    async def get_open_positions(self) -> list[Position]:
        payload = await self._signed_post("/0/private/OpenPositions", {"docalcs": "true"})
        return parse_open_positions(payload)

    async def get_trade_balance(self) -> MarginSummary:
        payload = await self._signed_post("/0/private/TradeBalance")
        return parse_trade_balance(payload)
```

(Leave `_raise_for_private_error` below, unchanged.)

- [ ] **Step 2: Run the full kraken + signing suite to confirm no regression**

Run: `cd api && python -m pytest tests/test_kraken.py tests/test_kraken_sign.py -v`
Expected: PASS (all existing + new parser tests; `test_sign_matches_kraken_published_vector` still passes)

- [ ] **Step 3: Commit**

```bash
git add api/app/adapters/kraken.py
git commit -m "feat(kraken): add get_open_positions and get_trade_balance methods"
```

---

## Task 6: Wire into the `/portfolio` route

Add two independent Kraken calls. Margin positions append into `positions`; the summary becomes `margin_summary`. Overall status is OK if positions, balances, **or** margin_summary has data.

**Files:**
- Modify: `api/app/routers.py:140-185`
- Test: `api/tests/test_routers.py`

- [ ] **Step 1: Write the failing test**

Add to `api/tests/test_routers.py`:

```python
from app.models import MarginSummary, Position


def test_portfolio_merges_kraken_margin_and_summary():
    kraken = get_registry().get("kraken")
    ibkr = get_registry().get("ibkr")

    async def _positions():
        return [Position(symbol="AAPL", qty=1, avg_cost=10, market_value=12, unrealized_pnl=2, source="ibkr")]

    async def _balances():
        return []

    async def _open_positions():
        return [Position(symbol="BTC/USD", qty=0.5, avg_cost=40000, market_value=21000,
                         unrealized_pnl=1000, margin_used=4000, side="long", source="kraken")]

    async def _trade_balance():
        return MarginSummary(equity=10000, used_margin=2000, free_margin=8000, margin_level=500,
                             unrealized_pnl=150, cost_basis=1900, valuation=2050)

    ibkr.get_positions = _positions
    kraken.get_balances = _balances
    kraken.get_open_positions = _open_positions
    kraken.get_trade_balance = _trade_balance

    r = client.get("/portfolio")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    symbols = {p["symbol"]: p for p in body["positions"]}
    assert symbols["AAPL"]["side"] is None
    assert symbols["BTC/USD"]["side"] == "long"
    assert symbols["BTC/USD"]["marginUsed"] == 4000
    assert body["marginSummary"]["freeMargin"] == 8000
    assert body["marginSummary"]["marginLevel"] == 500
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_routers.py::test_portfolio_merges_kraken_margin_and_summary -v`
Expected: FAIL — `marginSummary` is `None` / not present (route doesn't fetch it yet).

- [ ] **Step 3: Write minimal implementation**

In `api/app/routers.py`, update the import (line referencing models) to include `MarginSummary` if not already imported. Then replace the `/portfolio` handler body (lines 142-185) with:

```python
    positions: list[Position] = []
    balances: list[Balance] = []
    margin_summary: MarginSummary | None = None
    messages: list[str] = []
    sub_statuses: list[SourceStatus] = []

    ibkr = _adapter("ibkr")
    if ibkr is None:
        sub_statuses.append(SourceStatus.SOURCE_DOWN)
        messages.append("positions: IBKR not connected.")
    else:
        try:
            positions = await ibkr.get_positions()
        except Exception as exc:  # noqa: BLE001
            st, msg = _status_from_exc(exc)
            sub_statuses.append(st)
            messages.append(f"positions: {msg}")

    kraken = _adapter("kraken")
    if kraken is not None:
        try:
            balances = await kraken.get_balances()
        except Exception as exc:  # noqa: BLE001
            st, msg = _status_from_exc(exc)
            sub_statuses.append(st)
            messages.append(f"balances: {msg}")

        try:
            positions = positions + await kraken.get_open_positions()
        except Exception as exc:  # noqa: BLE001
            st, msg = _status_from_exc(exc)
            sub_statuses.append(st)
            messages.append(f"margin positions: {msg}")

        try:
            margin_summary = await kraken.get_trade_balance()
        except Exception as exc:  # noqa: BLE001
            st, msg = _status_from_exc(exc)
            sub_statuses.append(st)
            messages.append(f"margin summary: {msg}")

    # Any data at all -> OK (partial). Otherwise the most actionable sub-status.
    if positions or balances or margin_summary is not None:
        status = SourceStatus.OK
    elif SourceStatus.UNAUTHENTICATED in sub_statuses:
        status = SourceStatus.UNAUTHENTICATED
    elif SourceStatus.RATE_LIMITED in sub_statuses:
        status = SourceStatus.RATE_LIMITED
    elif sub_statuses:
        status = SourceStatus.SOURCE_DOWN
    else:
        status = SourceStatus.EMPTY
    return PortfolioResponse(
        status=status,
        message="; ".join(messages) or None,
        positions=positions,
        balances=balances,
        margin_summary=margin_summary,
    )
```

Confirm the models import line in `routers.py` includes `MarginSummary` (check the existing `from .models import ...` / `from app.models import ...` line near the top and add `MarginSummary` to it).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_routers.py -v`
Expected: PASS (new test + existing chart tests).

- [ ] **Step 5: Run the full backend suite**

Run: `cd api && python -m pytest`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add api/app/routers.py api/tests/test_routers.py
git commit -m "feat(portfolio): include Kraken margin positions + summary"
```

---

## Task 7: Regenerate frontend types + render margin UI

**Files:**
- Regenerate: `web/app/lib/api/schema.ts`
- Modify: `web/app/widgets/PortfolioWidget.tsx`

- [ ] **Step 1: Start the backend, regenerate types, stop it**

The generator reads the live OpenAPI schema. From `api/`:

```bash
cd api && (uvicorn app.main:app --host 127.0.0.1 --port 8000 &) && sleep 3
cd ../web && npm run gen:api
# stop the backend
kill %1 2>/dev/null || pkill -f "uvicorn app.main:app"
```

Verify `web/app/lib/api/schema.ts` now contains `marginSummary` under `PortfolioResponse` and `side` / `marginUsed` under `Position`, plus a new `MarginSummary` schema:

Run: `grep -n "marginSummary\|marginUsed\|MarginSummary" web/app/lib/api/schema.ts`
Expected: matches found.

- [ ] **Step 2: Add Side + Margin columns and the Margin Summary panel**

In `web/app/widgets/PortfolioWidget.tsx`, replace the POSITIONS `<section>` (lines 21-51) so the table has two new columns. Side renders the value or `—`; Margin renders `fmt(p.marginUsed)` or `—`:

```tsx
            <section>
              <h3 style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
                POSITIONS (IBKR + Kraken margin)
              </h3>
              {data.positions.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>No positions.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                      <th style={{ ...th, textAlign: "left" }}>Side</th>
                      <th style={th}>Qty</th>
                      <th style={th}>Avg Cost</th>
                      <th style={th}>Mkt Value</th>
                      <th style={th}>Margin</th>
                      <th style={th}>Unrl P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.positions.map((p) => (
                      <tr key={`${p.source}:${p.symbol}`} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={tdl}>{p.symbol}</td>
                        <td style={tdl}>{p.side ?? "—"}</td>
                        <td style={td}>{fmt(p.qty, 0)}</td>
                        <td style={td}>{fmt(p.avgCost)}</td>
                        <td style={td}>{fmt(p.marketValue)}</td>
                        <td style={td}>{p.marginUsed == null ? "—" : fmt(p.marginUsed)}</td>
                        <td style={{ ...td, color: signColor(p.unrealizedPnl) }}>{fmt(p.unrealizedPnl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
```

Then add a new Margin Summary section immediately after the BALANCES `</section>` (after line 79), before the closing `</div>`:

```tsx
            {data.marginSummary && (
              <section>
                <h3 style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
                  MARGIN SUMMARY (Kraken)
                </h3>
                <table style={{ borderCollapse: "collapse" }}>
                  <tbody>
                    {([
                      ["Equity", fmt(data.marginSummary.equity)],
                      ["Used Margin", fmt(data.marginSummary.usedMargin)],
                      ["Free Margin", fmt(data.marginSummary.freeMargin)],
                      ["Margin Level %", data.marginSummary.marginLevel == null ? "—" : fmt(data.marginSummary.marginLevel)],
                      ["Unrealized P&L", fmt(data.marginSummary.unrealizedPnl)],
                      ["Cost Basis", fmt(data.marginSummary.costBasis)],
                      ["Valuation", fmt(data.marginSummary.valuation)],
                    ] as const).map(([label, value]) => (
                      <tr key={label} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ ...tdl, color: "var(--muted)" }}>{label}</td>
                        <td style={td}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors. (If `marginUsed`/`side`/`marginSummary` are missing, the generated schema wasn't regenerated — redo Step 1.)

- [ ] **Step 4: Run frontend tests + build**

Run: `cd web && npm run test && npm run build`
Expected: tests PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/api/schema.ts web/app/widgets/PortfolioWidget.tsx
git commit -m "feat(portfolio): render margin positions columns + margin summary"
```

---

## Task 8: Final verification

- [ ] **Step 1: Backend suite**

Run: `cd api && python -m pytest`
Expected: all PASS.

- [ ] **Step 2: Frontend suite + typecheck + build**

Run: `cd web && npm run test && npx tsc --noEmit && npm run build`
Expected: all PASS / succeed.

- [ ] **Step 3: Manual smoke (optional, requires Kraken keys in `api/.env`)**

Start backend + frontend, open the `port` widget, confirm: IBKR rows show `—` for Side/Margin; Kraken margin rows show long/short + margin; Margin Summary panel appears with the seven metrics. If Kraken keys are absent, the widget must still render IBKR positions and an unauthenticated message for the Kraken parts (never crash).

---

## Self-Review Notes

- **Spec coverage:** Position extension (Task 1) ✓; MarginSummary (Task 1) ✓; PortfolioResponse field (Task 1) ✓; normalize_pair (Task 2) ✓; OpenPositions parse + docalcs (Tasks 3, 5) ✓; TradeBalance parse incl. missing ml (Tasks 4, 5) ✓; route merge + independent error handling + status logic (Task 6) ✓; frontend columns + panel + gen:api (Task 7) ✓; tests (Tasks 1-7) ✓.
- **Type consistency:** `parse_open_positions`, `parse_trade_balance`, `normalize_pair`, `get_open_positions`, `get_trade_balance`, `_signed_post`, `margin_summary` / `marginSummary`, `margin_used` / `marginUsed`, `side` used consistently across tasks.
- **No placeholders:** every code step shows full code; commands have expected output.
- **Field-code caveat:** Task 5 notes verifying Kraken `OpenPositions`/`TradeBalance` field semantics against official docs before trusting the parsers.
