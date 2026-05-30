# IBKR — Client Portal Web API via CP Gateway (read-only)

Hardest integration; stateful. Make the gateway base URL and port
env-configurable (default `https://localhost:5000/v1/api`).

## Connection
- I run IBKR's Client Portal Gateway (a local Java program) and authenticate by
  logging in through the browser. The backend calls the gateway's local REST base.
- The gateway uses a self-signed cert. In dev, the backend HTTP client disables TLS
  verification **for the localhost gateway only** — never globally.

## Session lifecycle (get this right or it fails silently)
- Poll `/tickle` (~every 60s) to keep the session alive.
- Check `/iserver/auth/status`. Distinguish and surface three states in the UI:
  (a) gateway unreachable, (b) gateway up but unauthenticated, (c) authenticated.
- Never crash on auth loss — show "log in at the gateway" and recover when the
  session returns.

## Symbols / conid
- Resolve symbol → conid via `/iserver/secdef/search`. It returns MULTIPLE conids
  (different exchanges/currencies). Apply a deterministic disambiguation rule
  (prefer the primary US listing / SMART routing) and document it.
- Cache symbol→conid so quotes don't re-search on every call.

## Market data (snapshot)
- Snapshot fields are NUMERIC field codes. Look the codes up in IBKR's official
  docs; do NOT hardcode a guessed mapping.
- The FIRST snapshot request often returns empty — re-request. You may need to call
  the accounts endpoint before market data works.
- Only entitled instruments return live data; others are delayed or empty. Mark
  such quotes `stale: true` and handle missing fields.

## Portfolio (read-only)
- Use the account list + positions endpoints; normalize to the canonical Position
  shape.

## Future deployment (do NOT solve now)
- Note in the README that the gateway requires a manual same-machine browser login,
  which will complicate server deployment later.
