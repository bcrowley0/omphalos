# Kraken Margin Positions + Margin Summary in Portfolio

**Date:** 2026-05-31
**Status:** Approved design

## Goal

Surface Kraken margin data in the portfolio widget: open margin positions
(merged into the existing positions table) and an account-level margin summary
panel. All read-only — consistent with the v1 read-only rule. Reuses the
existing Kraken HMAC-SHA512 signing and nonce infrastructure.

## Background

Kraken exposes two relevant read-only private endpoints:

- **`POST /0/private/OpenPositions`** — individual open margin positions. Must
  pass `docalcs=true` to populate `value` (floating valuation) and `net`
  (unrealized P&L). Returns a dict keyed by txid; each value has `pair`, `type`
  (`buy`/`sell`), `vol`, `cost`, `margin`, `value`, `net`, etc.
- **`POST /0/private/TradeBalance`** — account-level margin summary. Returns
  field codes: `e` (equity), `m` (margin of open positions), `mf` (free
  margin), `ml` (margin level %; **omitted when there are no open positions**),
  `n` (unrealized net P&L), `c` (cost basis), `v` (floating valuation).

> **Implementation note:** verify the exact `OpenPositions` / `TradeBalance`
> field codes and semantics against Kraken's official API docs before
> finalizing the parsers (per `.claude/rules/kraken.md` — implement exactly per
> docs, no guessing).

## Data model (`api/app/models.py`)

### Extend `Position`

Add two optional margin-specific fields. IBKR positions leave them `None`.

```python
class Position(CamelModel):
    symbol: str
    qty: float
    avg_cost: float
    market_value: float
    unrealized_pnl: float
    source: str
    side: str | None = None          # "long" | "short" — Kraken margin only
    margin_used: float | None = None  # margin committed to this position
```

### New `MarginSummary`

```python
class MarginSummary(CamelModel):
    equity: float                  # e  = trade balance + unrealized P&L
    used_margin: float             # m  = margin of open positions
    free_margin: float             # mf = equity - initial margin
    margin_level: float | None     # ml = (equity / initial margin) * 100;
                                   #      None when no open positions
    unrealized_pnl: float          # n
    cost_basis: float              # c
    valuation: float               # v  = floating valuation of open positions
    source: str = "kraken"
```

### Extend `PortfolioResponse`

```python
class PortfolioResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    positions: list[Position] = []
    balances: list[Balance] = []
    margin_summary: MarginSummary | None = None
```

## Kraken adapter (`api/app/adapters/kraken.py`)

Two new signed methods reusing `sign_request()` and the `_NonceFactory`.

### `get_open_positions() -> list[Position]`

- `POST /0/private/OpenPositions` with form data `docalcs=true`.
- Parser `parse_open_positions(resp)` maps each open position dict → `Position`:
  - `symbol` = `normalize_pair(pair)` (see below)
  - `side` = `"long"` if `type == "buy"` else `"short"`
  - `qty` = `float(vol)`
  - `avg_cost` = `float(cost) / float(vol)` (per-unit entry price; guard
    against `vol == 0`)
  - `market_value` = `float(value)`
  - `unrealized_pnl` = `float(net)`
  - `margin_used` = `float(margin)`
  - `source` = `"kraken"`

### `get_trade_balance() -> MarginSummary`

- `POST /0/private/TradeBalance`.
- Parser `parse_trade_balance(resp)` maps field codes →
  `MarginSummary`. `margin_level` is `None` when the `ml` key is absent
  (no open positions).

### `normalize_pair(pair) -> str`

New helper. Kraken returns pair names like `XXBTZUSD`. Reuse the existing
`normalize_asset()` logic to split into base/quote and produce canonical
`"BTC/USD"`. If the pair can't be confidently split/mapped, fall back to the
raw pair string so a row is never dropped.

## Portfolio route (`api/app/routers.py`)

Extend the existing per-source try/except aggregation. Kraken now makes three
independent calls: `get_balances` (existing), `get_open_positions`,
`get_trade_balance`. Each is wrapped in its own error handling so one failure
never crashes the widget or blocks the others.

- Kraken margin positions are **appended into the same `positions[]` list** as
  IBKR positions.
- `margin_summary` is set when `TradeBalance` succeeds; otherwise `None`.
- Overall `status` is `OK` when **any** of positions / balances /
  margin_summary has data. The existing most-actionable-error precedence
  (`UNAUTHENTICATED` > `RATE_LIMITED` > `SOURCE_DOWN` > `EMPTY`) is retained for
  the no-data case.

## Frontend (`web/app/widgets/PortfolioWidget.tsx`)

- **Positions table** gains **Side** and **Margin** columns. For IBKR rows the
  fields are `null` and render blank (e.g. `—`).
- **New Margin Summary panel** — a key/value block rendered only when
  `marginSummary` is present, showing all seven metrics: Equity, Used Margin,
  Free Margin, Margin Level %, Unrealized P&L, Cost Basis, Valuation. P&L uses
  the existing `signColor()` utility.
- Regenerate TypeScript via `npm run gen:api` (no hand-written types — types
  flow from the OpenAPI schema).

## Error handling

- All three Kraken calls already map gateway/HTTP errors to canonical adapter
  exceptions via `api/app/http.py`; the route catches them per-source.
- Empty `OpenPositions` (no margin positions) → empty list, not an error.
- Missing `ml` in `TradeBalance` → `margin_level = None`; UI renders `—`.
- `vol == 0` guard in `avg_cost` to avoid division by zero.

## Testing (TDD)

Backend unit tests (`api/tests/`):
- `parse_open_positions` — sample Kraken response → `Position` list with
  correct `side`, `qty`, `avg_cost`, `margin_used`.
- `parse_trade_balance` — sample → `MarginSummary`; and a sample missing `ml`
  → `margin_level is None`.
- `normalize_pair` — `XXBTZUSD` → `BTC/USD`; unmappable pair → raw fallback.

Frontend tests:
- Positions table renders Side / Margin columns; IBKR rows show blanks.
- Margin Summary panel renders when `marginSummary` present and is absent when
  `null`.

## Out of scope

- No order entry / margin trading actions (read-only v1).
- No websockets / streaming (snapshot on open + explicit refresh only).
- No new top-level command — this enriches the existing `port` widget.
