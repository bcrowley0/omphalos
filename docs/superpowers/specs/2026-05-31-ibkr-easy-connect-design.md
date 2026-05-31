# IBKR Easy-Connect — Design

**Date:** 2026-05-31
**Status:** Approved (brainstorming) — pending implementation plan

## Problem

Connecting to IBKR requires running the Client Portal Gateway locally and logging
in through the browser at `https://localhost:5000`. Today the app surfaces this
only reactively: when the portfolio widget fails it shows an inline
"Log in at the IBKR gateway" message, and the Settings → Connections section shows
static text. There is no one-click way to open the gateway login, and no proactive
signal on app load that you are not connected.

This feature makes connecting easier: a one-click "Open gateway login" button on
multiple surfaces, a proactive banner on load when not authenticated, and a live
auth-state indicator — all driven by backend config so the URL never gets
hardcoded in the frontend.

## Goals

- One click opens the IBKR gateway login page in a new browser tab.
- On app load, proactively prompt to log in **only when not authenticated**.
- Live IBKR auth state (authenticated / unauthenticated / unreachable) is visible
  in Settings and drives the banner.
- After logging in at the gateway tab, the app re-checks on window focus and via an
  explicit "Re-check" button — no background polling.

## Non-goals

- No streaming/websockets, no continuous polling (CLAUDE.md hard rule #5).
- No order entry; this is read-only auth/connection UX only.
- No change to how IBKR market-data / portfolio data is fetched.
- The frontend never calls the gateway directly for data — it only opens the
  gateway's own login page in a browser tab.

## Decisions (from brainstorming)

1. **Auto-open behavior:** Smart prompt with one click (a banner shown when
   unauthenticated; user clicks once to open login). No silent auto-open — browsers
   block `window.open` outside a user gesture.
2. **Surfaces:** All three — global banner on load, Settings → Connections, and the
   Portfolio widget inline.
3. **Re-check:** On window focus + explicit "Re-check" button. No background poll.

## Architecture

### Chosen approach

A **dedicated live auth endpoint** on the backend plus a **shared React context** on
the frontend.

- Rejected: overloading the existing `GET /status` endpoint. `/status` also serves
  FRED/Kraken and is cheap; probing the IBKR gateway on every call would add latency
  and couple unrelated concerns.
- Rejected: each surface fetching auth state independently. A shared context gives
  one fetch, one source of truth, and one focus-listener instead of three.

### Backend (`api/`)

**New endpoint:** `GET /ibkr/auth` → new pydantic model `IbkrAuthResponse`:

```
{
  state: "authenticated" | "unauthenticated" | "unreachable",
  loginUrl: str,   # e.g. "https://localhost:5000"
  detail: str      # human-readable guidance for the current state
}
```

**New adapter method:** `IbkrAdapter.get_auth_state()` in
`api/app/adapters/ibkr.py`. Reuses the existing `_ensure_session()` probe logic
(`/tickle`, falling back to `/iserver/auth/status`) but **returns** one of the three
states instead of raising:
- tickle/status reports authenticated → `authenticated`
- gateway reachable but session not authenticated → `unauthenticated`
- gateway connection error / unreachable → `unreachable`

This method never raises; the endpoint never crashes (CLAUDE.md hard rule #6).

**`loginUrl` derivation:** computed from `settings.ibkr_gateway_base_url`
(`config.py`) by parsing the origin (scheme + host + port) and dropping the
`/v1/api` path, via `urllib.parse`. Config remains the single source of truth; the
frontend never hardcodes the URL.

### Frontend (`web/`)

**Type generation:** regenerate the OpenAPI-derived TS types/client so
`IbkrAuthResponse` is available. No hand-written duplicate interface (type-contract
rule).

**`IbkrAuthProvider` (React context):** mounted at the terminal root. Owns state
`{ state, loginUrl, detail, loading, recheck() }`. Fetches:
- on mount,
- on `window` `focus` (debounced so refocus doesn't spam),
- on manual `recheck()`.

It is the single source of truth consumed by all three surfaces.

**Shared components:**
- `<IbkrLoginButton>` — opens `loginUrl` in a new tab on a real click
  (`window.open(loginUrl, "_blank", "noopener")`), so the popup blocker does not
  fire.
- `<IbkrAuthBanner>` — the global banner.

**Surfaces:**
1. **Global banner** — rendered in the terminal shell, visible only when state is
   `unauthenticated` or `unreachable`. Contains: status text, "Open gateway login"
   button, "Re-check" button, and a dismiss control. Dismissal is session-local
   (component state); the banner reappears on reload or if the auth state changes
   back to a not-connected state.
2. **Settings → Connections** — replace the static IBKR detail text with a live dot
   (green = authenticated, yellow = unauthenticated, red = unreachable) plus
   "Open gateway login" and "Re-check". Always present, even when connected.
3. **Portfolio widget** — when the portfolio response is `unauthenticated`, render
   `<IbkrLoginButton>` inline next to the existing status notice.

## Data flow

```
load / focus / re-check
        │
        ▼
IbkrAuthProvider.recheck()
        │  GET /ibkr/auth → FastAPI
        ▼
GET /ibkr/auth  ──►  IbkrAdapter.get_auth_state()  ──►  gateway /tickle | /iserver/auth/status
        │                                                   (TLS-verify disabled for localhost only)
        ▼
IbkrAuthResponse { state, loginUrl, detail }
        │
        ▼
context state  ──►  Banner / Settings dot / Portfolio inline button
```

Clicking "Open gateway login" opens `loginUrl` (the gateway's own login UI) in a new
browser tab. The user logs in there. On returning to the Omphalos tab, the focus
listener fires `recheck()`; the banner clears when state becomes `authenticated`.

## Error & edge states

- Gateway down → `unreachable`; banner shows a "gateway not running" message with
  the login button still available (so the user can start the flow once it is up).
- The `/ibkr/auth` call itself failing (backend down) → treated as unknown/loading;
  the banner stays hidden rather than showing a false prompt.
- Already authenticated → no banner; Settings shows a green dot.

## Testing

**Backend (pytest):**
- `get_auth_state()` returns `authenticated` / `unauthenticated` / `unreachable` for
  the corresponding gateway responses and connection errors (mock the gateway).
- `loginUrl` derivation strips `/v1/api` and preserves host/port for representative
  `IBKR_GATEWAY_BASE_URL` values.
- `GET /ibkr/auth` endpoint returns the model and never 500s on gateway failure.

**Frontend:**
- Pure helper deriving banner visibility from `state`.
- Component test: `<IbkrLoginButton>` calls `window.open` with the provided
  `loginUrl`; focus event triggers `recheck`.
- Follow existing test patterns (current suite is 48/48 green).

## CLAUDE.md compliance

- Read-only v1; no order entry. ✓
- Backend proxy mandatory — frontend only opens the gateway's login page in a tab
  (not a data call); auth state is fetched through FastAPI. ✓
- No websockets/streaming/polling — re-check is on-demand (focus + button). ✓
- Explicit visible UI states for loading / source-down / unauthenticated. ✓
- Type contract — TS generated from OpenAPI, no hand-written duplicate. ✓
- Gateway URL stays config-driven (`IBKR_GATEWAY_BASE_URL`); never hardcoded in the
  frontend. ✓
```
