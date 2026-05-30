# Omphalos

A local-first finance **terminal**: type plain-verb commands into a command bar to
spawn read-only widgets (chart, quote, watchlist, portfolio, yield curve, news,
crypto). Prototype runs entirely on localhost.

See [`CLAUDE.md`](./CLAUDE.md) for the binding architecture rules, type contract,
canonical data model, and command grammar.

## Architecture

```
browser ──> Next.js (:3000) ──/api/* rewrite──> FastAPI (:8000) ──> third-party APIs
                                                   └─ holds ALL secrets (api/.env)
```

The browser never holds secrets and never calls third-party APIs directly. Every
external call goes through the FastAPI backend. The frontend reaches the backend
through a Next.js rewrite proxy (`/api/*` → backend), so there is no CORS config.

Monorepo layout:

- `web/` — Next.js (App Router) + TypeScript frontend.
- `api/` — FastAPI (Python) backend, a separate process that holds all keys.

## Prerequisites

- **Node** 22.x (`.nvmrc` pins `22.22.2`; run `nvm use`).
- **Python** 3.14.x (`api/.python-version` pins `3.14.4`).

## Setup & run

Two processes, two terminals. Start the backend first.

### 1. Backend (FastAPI) — http://127.0.0.1:8000

```bash
cd api
python3 -m venv .venv                       # first time only
./.venv/bin/pip install -r requirements.txt # first time only (pinned lockfile)
cp .env.example .env                         # first time only; fill in keys as phases need them
./.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Bound to `127.0.0.1` only — this process holds all API keys.

- Health: <http://127.0.0.1:8000/health>
- Interactive API docs: <http://127.0.0.1:8000/docs>

### 2. Frontend (Next.js) — http://localhost:3000

```bash
cd web
npm install   # first time only
npm run dev
```

Open <http://localhost:3000> — the finance terminal. Type commands in the bar (see
below); a backend-health chip in the header shows connectivity. Every widget has
explicit loading / error / empty / source states and an on-demand **refresh**.

## Dependency management

- **Frontend:** npm. `web/package-lock.json` is the committed lockfile.
- **Backend:** [pip-tools]. Top-level deps live in `api/requirements.in`; the pinned
  lockfile `api/requirements.txt` is generated with:
  ```bash
  ./.venv/bin/pip-compile requirements.in -o requirements.txt
  ```
  Install from the lockfile with `pip install -r requirements.txt`.

## Secrets & data sources

Secrets live **only** in `api/.env` (gitignored), loaded via pydantic-settings.
`api/.env.example` documents the variables with placeholders. No secret ever lives
in frontend code or in git. Every external call is proxied through the backend.

| Source | Used by | Auth | Without it |
| --- | --- | --- | --- |
| Kraken public | `crypto`, `chart <PAIR>` | none | works out of the box |
| RSS (FT/WSJ/custom) | `news` | none | works out of the box |
| FRED | `yield` | `FRED_API_KEY` | shows the **unauthenticated** state |
| Kraken private | `port` balances | `KRAKEN_API_KEY`/`SECRET` | shows the **unauthenticated** state |
| IBKR gateway | `port` positions, equity `quote`/`chart` | running CP Gateway | shows **gateway down** / **log in** |

Get a free FRED key at <https://fred.stlouisfed.org/docs/api/api_key.html> and a
read-only Kraken key in your Kraken account; put them in `api/.env`.

## IBKR Client Portal Gateway setup

Equity quotes and IBKR positions require IBKR's **Client Portal Gateway** running
on the same machine:

1. Download the Client Portal Gateway from IBKR and start it (a local Java
   program). It listens on `https://localhost:5000` with a **self-signed cert**.
2. Open <https://localhost:5000> in your browser and **log in** to your IBKR
   account. The session must stay authenticated.
3. Set `IBKR_GATEWAY_BASE_URL` in `api/.env` if your gateway differs from the
   default `https://localhost:5000/v1/api`.

The backend disables TLS verification **for this localhost gateway client only**
(never globally). The terminal distinguishes three states: *gateway down* (not
running), *log in at the gateway* (running but not authenticated), and connected.

> **Future deployment caveat:** the gateway requires a manual, same-machine
> browser login, which will complicate any future server-side deployment — the
> gateway can't be headlessly authenticated. This is noted for later; not solved
> now.

## Commands (the terminal)

Type into the command bar (⌘/Ctrl-K focuses it; ↑/↓ recalls history). Each command
opens or focuses a widget tab:

| Command | Widget |
| --- | --- |
| `chart <SYMBOL>` | price chart (Lightweight Charts) |
| `quote <SYMBOL>` | snapshot quote |
| `watch <SYMBOL>` / `unwatch <SYMBOL>` | add/remove watchlist symbol (opens watchlist) |
| `crypto <PAIR>` | crypto ticker + chart, e.g. `crypto BTC/USD` |
| `port` | portfolio: positions + balances |
| `yield` | Treasury yield curve |
| `news [feed]` | headlines (optional feed), linking out |
| `follow <name>` / `unfollow <name>` | follow/unfollow a person (e.g. `follow Andrej Karpathy`) |
| `following` | roster + aggregated feed of followed people's public items |
| `cal` | economic calendar (stubbed "not implemented") |
| `help` | command list |

**Follow People:** aggregates public items about/by the people you follow — news,
articles, interviews, podcasts/talks — from a free Google News search per person
plus any first-party feeds (blog/YouTube) you attach. On-demand + cached; a "●"
marks items newer than your last visit. The follow-list persists in `localStorage`.

Defaults to a **"primary & on-topic"** view (a toggle reveals all coverage). An item
shows in the curated view when it is:
- **primary** — first-party content (the person's own attached feeds) or a
  wire-grade/official publisher (Reuters, Bloomberg, AP, FT, WSJ, press-release
  wires); aggregators/blogs are secondary, and
- **on-topic** — the person's name (or surname) appears in the headline, dropping
  industry/company stories that merely mention them in the body.

**Duplicate stories are collapsed** feed-wide: near-identical headlines covering the
same event across outlets are merged into one (keeping the primary/earliest), so the
same scoop doesn't appear five times. Note: exact "who published first" can't be
determined from RSS, so this is a source-quality + relevance + dedupe filter, not a
true scoop detector. Primary items are never truncated by the per-person cap.

Open tabs and the watchlist persist in `localStorage` across refreshes. Unknown
commands show an inline error.

## Type contract & code generation

The backend Pydantic models are the single source of truth. The frontend client is
GENERATED from the backend OpenAPI schema — never hand-written:

```bash
cd web && npm run gen:api    # backend must be running on :8000
```

This writes `web/app/lib/api/schema.ts` (committed). A backend field change that the
frontend relies on therefore breaks the build, not runtime.

## Tests

```bash
cd web && npm test     # Vitest: parser, router, tab mapping, terminal store
cd api && ./.venv/bin/pytest    # pytest: adapter normalization, Kraken signing, IBKR session
```

## Status

Built in phases (see `PROMPT.md`). All phases complete:

- **Phase 0 — scaffold:** monorepo, health round-trip through the proxy, git
  hygiene, pinned versions, committed lockfiles.
- **Phase 1 — framework on mock data:** async adapter interface + registry +
  `MockAdapter`; generated typed frontend client; unit-tested command parser +
  symbol router; tabbed terminal with `localStorage` persistence; a widget per
  command with shared loading/error/empty/source-status UI.
- **Phase 2 — FRED + Kraken public (real):** shared httpx layer with structured
  outbound logging + TTL cache; Kraken Ticker/OHLC; FRED yield curve.
- **Phase 3 — Kraken private:** signed balances (HMAC-SHA512 verified against
  Kraken's published vector); missing key → unauthenticated state.
- **Phase 4 — News:** generic server-side RSS adapter (FT/WSJ + runtime feeds),
  headlines linking out only.
- **Phase 5 — IBKR CP Gateway (read-only):** session lifecycle (tickle/auth
  status), conid resolution + cache, documented numeric snapshot fields, positions;
  three explicit gateway states; TLS off for the localhost gateway only.

[pip-tools]: https://github.com/jazzband/pip-tools
