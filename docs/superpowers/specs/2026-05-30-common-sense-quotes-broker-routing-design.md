# Common-sense quotes + broker name-linking — design

**Date:** 2026-05-30
**Status:** Approved (pending spec review)

## Goal

Make quotes (and charts) "just work" from whatever the user types, and make
broker routing explicit and centralized:

- `btc` ≡ `btc/usd` ≡ `btcusd` — all resolve to the same Kraken **BTC/USD** quote.
- `aapl` resolves to an IBKR equity quote.
- A single **name-linking system** decides crypto → Kraken, tradfi → IBKR, and
  produces one canonical display symbol per input.

This replaces today's purely syntactic rule (a `/` means Kraken, no `/` means
IBKR), which is why `quote BTC/USD` works but `quote BTC` and `quote BTCUSD`
wrongly go to IBKR and fail.

## Non-goals

- No user-extensible aliases in v1 — the registry is curated and static. (Noted
  as a possible later extension, mirroring the watchlist mechanism.)
- No new data sources; no order entry; no streaming (CLAUDE.md hard rules).
- No fuzzy matching / search — resolution is deterministic table lookup only.

## Coordination with in-flight work

This builds on the `feat/chart-span-interval-controls` branch, which added
`Interval`/`Span` enums and `interval`/`span` query params + echo fields to
`/chart/{symbol}` and `/crypto/{base}/{quote_ccy}`. Relative to that work this
design:

- **Removes** the `/crypto/{base}/{quote_ccy}` endpoint and `CryptoResponse`.
- **Moves** the `/chart` and `/quote` symbol from a path param to a **query
  param** and routes crypto through them. The `interval`/`span` params and echo
  fields on `CandlesResponse` are preserved unchanged.

## The name-linking system — backend resolver

A new pure, unit-tested module `api/app/symbols.py` replaces the trivial
`api/app/routing.py`. It owns all routing and normalization (single source of
truth, per CLAUDE.md's symbol-router rule).

### Registry (curated, static)

- `CRYPTO_BASES` — known crypto base assets, e.g.
  `BTC, ETH, SOL, XRP, ADA, DOGE, LTC, DOT, LINK, AVAX, MATIC, ATOM, XLM, BCH,
  UNI, AAVE`. Plus input aliases that fold to a canonical base (`XBT → BTC`,
  `XDG → DOGE`) so Kraken's own legacy codes are accepted as input too.
- `QUOTE_CCYS` — known quote currencies for splitting glued forms:
  `USD, USDT, USDC, EUR, GBP`.
- `DEFAULT_QUOTE = "USD"`.

The Kraken adapter already maps a canonical pair to Kraken's altname
(`BTC/USD → XBTUSD` via `_BASE_ALIASES`), so the resolver hands it the canonical
`BASE/QUOTE` form and does **not** duplicate that mapping.

### Resolution

```python
@dataclass(frozen=True)
class Resolved:
    source: str          # "kraken" | "ibkr"
    display: str         # canonical label shown in the UI, e.g. "BTC/USD" or "AAPL"
    symbol: str          # what the adapter receives: "BTC/USD" (kraken) or "AAPL" (ibkr)

def resolve(raw: str) -> Resolved: ...
```

Order (case-insensitive, trimmed, uppercased):

1. **Contains `/`** → split `base`/`quote`. Fold `base` through the crypto
   aliases. If `base` is a crypto base → Kraken `BASE/QUOTE`. (An unknown base
   with a slash still routes to Kraken — preserves today's behavior; the adapter
   surfaces a clean source error if the pair is invalid.)
2. **No `/`, ends with a known quote ccy and the prefix is a crypto base** →
   `BTCUSD → BTC/USD` (Kraken). Longest-quote-suffix match wins (so `USDT`
   beats `USD`).
3. **No `/`, the whole token is a crypto base** → `BTC → BTC/USD` (Kraken,
   default quote).
4. **Otherwise** → IBKR ticker, `display == symbol == raw.upper()`.

Examples: `btc`, `BTC/USD`, `btcusd`, `xbt` → Kraken `BTC/USD`; `eth/eur`,
`ethusdt` → Kraken `ETH/EUR` / `ETH/USDT`; `aapl`, `MSFT` → IBKR.

Edge cases made explicit:
- A bare quote currency typed alone (e.g. `usd`) is not a crypto base and has no
  crypto prefix → falls through to IBKR (will surface as an unknown-symbol error
  there, an acceptable outcome — not a crash).
- A non-crypto ticker that happens to end in a quote ccy (none in the common US
  equity set do for the v1 `QUOTE_CCYS`) only reroutes to Kraken if its prefix is
  also a crypto base; otherwise rule 2 doesn't fire and it stays IBKR.

## API — fold `/crypto` into `/quote` and `/chart`

Both endpoints take the symbol as a **query param** to carry a `/` safely
(avoids the `%2F` encoded-slash pitfalls of path params — the original reason a
separate `/crypto` endpoint existed):

- `GET /quote?symbol=<raw>` → `QuoteResponse`
- `GET /chart?symbol=<raw>&interval=<Interval>&span=<Span>` → `CandlesResponse`

Each handler calls `resolve(symbol)`, looks up the adapter for `resolved.source`,
calls the canonical operation with `resolved.symbol`, and echoes
`resolved.display` as the response `symbol` and `resolved.source` as `source`
(both fields already exist). All adapter exceptions continue to map to explicit
`SourceStatus` values via the existing `_status_from_exc` (CLAUDE.md rule 6).

**Removed:** `GET /crypto/{base}/{quote_ccy}` and the `CryptoResponse` model.
`/chart` retains the in-flight `interval`/`span` controls and now serves crypto
pairs through the unified resolver.

The `source_for_symbol` helper in `routing.py` is removed; `routing.py` is
deleted in favor of `symbols.py`.

## Frontend — delete the duplicate router

Backend owns routing, so the frontend stops mirroring it:

- **`web/app/lib/command/router.ts`** — deleted. `routeSymbol` and the `Source`
  type are removed (the response's `source` field is the source of truth for
  display).
- **`web/app/lib/command/parser.ts`** — retire the `crypto` verb. `quote`,
  `chart`, `watch`, `unwatch` already keep a slashed token intact (`split(/\s+/)`
  then `toUpperCase()`), so `quote btc/usd` parses as symbol `BTC/USD` with no
  change beyond removing the `crypto` case.
- **`web/app/lib/command/types.ts`** — remove `{ kind: "crypto"; pair }` from
  `Command`, the `Source` type, `"crypto"` from `WidgetKind`, and `pair` from
  `Tab`.
- **`web/app/lib/command/tabs.ts`** — remove the `crypto` case.
- **`web/app/lib/loaders.ts`** — `loadQuoteData`/`loadChartData` drop the
  `routeSymbol` branch and call `/quote`/`/chart` with the raw symbol; remove
  `loadCrypto`. `loadWatchlist` is unaffected (still maps over `loadQuoteData`).
- **`web/app/widgets/CryptoWidget.tsx`** — deleted. Crypto symbols now use the
  same `QuoteWidget` and `ChartWidget` as equities. `WidgetHost` drops the
  `crypto` case.
- **`web/app/components/CommandBar.tsx`** — remove the `crypto` suggestion;
  reflect that `quote`/`chart` accept crypto (e.g. `quote btc`).
- **`web/app/widgets/HelpWidget.tsx`** — update the command list (drop `crypto`,
  note crypto works through `quote`/`chart`).

### Accepted consequence

Retiring `crypto` removes the combined quote+chart widget. Viewing both for BTC
now means `quote btc` and `chart btc`. The displayed symbol everywhere becomes
the canonical form (`BTC/USD`), with `source` shown so the user sees which broker
served the quote.

## Type contract

The OpenAPI TS client is regenerated after the backend change. Removing
`CryptoResponse` and the `/crypto` path, and moving `symbol` to a query param,
flows through the generated client — any stale frontend usage breaks the build
rather than failing at runtime (CLAUDE.md type-contract rule).

## Error & edge handling

- Missing `symbol` query param → FastAPI 422 → existing error state.
- Unknown symbol routed to IBKR/Kraken → adapter surfaces source error /
  empty → existing `ResourceView` states. Never an unhandled crash.
- Resolver is total: every input returns a `Resolved` (defaults to IBKR), so it
  never raises.

## Testing

Backend:
- `api/tests/test_symbols.py` (new) — `resolve` table: `btc`, `BTC/USD`,
  `btcusd`, `xbt`, `eth/eur`, `ethusdt` (USDT-suffix beats USD), `doge`, `aapl`,
  `MSFT`, bare `usd`, unknown-glued ticker. Assert `source`, `display`, `symbol`.
- Update `api/tests/test_routing.py` → folded into `test_symbols.py` (delete old
  file).
- Update router tests: `/quote?symbol=…` and `/chart?symbol=…` dispatch to the
  right adapter and echo canonical `symbol`/`source`; remove `/crypto` tests.

Frontend:
- `web/app/lib/command/parser.test.ts` — remove `crypto` cases; add
  `quote btc/usd` and confirm unknown verb `crypto` now errors.
- `web/app/lib/command/router.test.ts` — deleted.
- `web/app/lib/command/tabs.test.ts` — remove `crypto` tab case.

## Files touched (estimate)

- `api/app/symbols.py` — **new** (registry + `resolve`).
- `api/app/routing.py` — **deleted**.
- `api/app/routers.py` — `/quote` & `/chart` take query `symbol`, use `resolve`;
  remove `/crypto`.
- `api/app/models.py` — remove `CryptoResponse`.
- `api/tests/test_symbols.py` — **new**; `api/tests/test_routing.py` deleted.
- `web/app/lib/command/router.ts` — **deleted**.
- `web/app/lib/command/parser.ts`, `types.ts`, `tabs.ts` — retire `crypto`.
- `web/app/lib/loaders.ts` — unified loaders; remove `loadCrypto`.
- `web/app/widgets/CryptoWidget.tsx` — **deleted**; `WidgetHost.tsx` updated.
- `web/app/components/CommandBar.tsx`, `web/app/widgets/HelpWidget.tsx` — grammar.
- Regenerated OpenAPI TS client.
- Tests (backend + frontend) as above.
