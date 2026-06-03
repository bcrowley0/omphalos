# Omphalos

A local-first finance **terminal**: type plain-verb commands into a command bar to
spawn read-only widgets (chart, quote, watchlist, portfolio, yield curve, news,
crypto). Prototype runs entirely on localhost.

See [`CLAUDE.md`](./CLAUDE.md) for the binding architecture rules, type contract,
canonical data model, and command grammar.

**Repository:** <https://github.com/bcrowley0/omphalos>

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

```bash
git clone https://github.com/bcrowley0/omphalos.git
cd omphalos
```

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
- **Backend:** [pip-tools](https://github.com/jazzband/pip-tools). Top-level deps live in `api/requirements.in`; the pinned
  lockfile `api/requirements.txt` is generated with:
  ```bash
  ./.venv/bin/pip-compile requirements.in -o requirements.txt
  ```
  Install from the lockfile with `pip install -r requirements.txt`.

## Parallel development (multiple agents / sessions)

Run **one session per working directory, each on its own branch.** Multiple
sessions sharing the same checkout and branch will interleave commits and edit each
other's files — use `git worktree` to give each its own isolated tree off `main`:

```bash
git worktree add ../omphalos-a -b feat/work-a main   # one per concurrent lane
cd ../omphalos-a/web && npm ci                        # real install (see caveat 1)
ln -s "$(git -C ../.. rev-parse --show-toplevel)/api/.venv" ../omphalos-a/api/.venv  # share deps
```

Point each session at its own dir (e.g. `/path/omphalos-a`) and tell it to stay on
that branch. When a lane is done, merge to `main`, then
`git worktree remove ../omphalos-a && git branch -d feat/work-a`.

Caveats:
1. **Don't symlink `web/node_modules`** — `tsc`/`vitest` tolerate it but `next build`
   (Turbopack) rejects a symlink pointing outside the tree. Run a real `npm ci` per
   worktree.
2. **Share the Python venv** by symlinking `api/.venv` (the project isn't installed
   editable, so each worktree's `pytest` imports its own `app/`). Don't `pip install`
   in two lanes at once — do dependency changes in one lane while the others idle.
3. **Dev servers clash on ports.** Only one process can bind `:8000`/`:3000`; give a
   second lane different ports (and point its Next.js proxy at the matching API port)
   if you need two live apps at once. Editing/tests don't need the servers.

## Secrets & data sources

Secrets live **only** in `api/.env` (gitignored), loaded via pydantic-settings.
`api/.env.example` documents the variables with placeholders. No secret ever lives
in frontend code or in git. Every external call is proxied through the backend.

| Source | Used by | Auth | Without it |
| --- | --- | --- | --- |
| Kraken public | `crypto`, `chart <PAIR>` | none | works out of the box |
| RSS (FT/WSJ/Bloomberg/CNBC/Economist/X·Nitter/custom) | `news` | none | works out of the box |
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

### IBKR OAuth 1.0a (headless alternative)

Two auth modes are now supported:

- **gateway** (default) — the Client Portal Gateway setup above; requires a
  running Java process and a manual browser login on the same machine.
- **oauth** — headless OAuth 1.0a; no gateway process, no browser login. Routes
  directly to `https://api.ibkr.com/v1/api`. Server-deployable; removes the
  same-machine-login constraint noted above.

**Mode selection:** OAuth is activated automatically when all six
`IBKR_OAUTH_*` env vars are present. Set `IBKR_AUTH_MODE=oauth` or
`IBKR_AUTH_MODE=gateway` in `api/.env` to force a mode explicitly.

**One-time setup in the IBKR self-service portal:**

1. Register an OAuth consumer and note the **consumer key**.
2. Generate two RSA key pairs (one for request signing, one for encryption);
   upload the **public** keys to the portal.
3. Mint an **access token** and **access token secret**.
4. Obtain the **Diffie-Hellman prime** from the portal.
5. Place the RSA **private** key files in `api/secrets/` (gitignored) and set
   the paths below.

**Env vars to add to `api/.env`:**

```
IBKR_OAUTH_CONSUMER_KEY=
IBKR_OAUTH_ACCESS_TOKEN=
IBKR_OAUTH_ACCESS_TOKEN_SECRET=
IBKR_OAUTH_SIGNATURE_KEY_PATH=api/secrets/signature.pem
IBKR_OAUTH_ENCRYPTION_KEY_PATH=api/secrets/encryption.pem
IBKR_OAUTH_DH_PRIME=
```

The auth handshake is implemented via the [`ibind`](https://github.com/Voyz/ibind)
library; the adapter's data path (quotes, positions, conid resolution) is
unchanged. See the design spec at
[`docs/superpowers/specs/2026-06-02-ibkr-oauth-design.md`](docs/superpowers/specs/2026-06-02-ibkr-oauth-design.md)
for implementation details.

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
| `yield` | Treasury yield curve — current + historical as-of curves with per-tenor basis-point change columns |
| `news [feed]` | headlines, linking out; no feed = **All** (every configured source, round-robin merged so no high-frequency source dominates), or name one: `news FT`, `news WSJ`, `news Bloomberg`, `news CNBC`, `news Economist`, plus several X/Twitter market accounts (Nitter-bridged) |
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

### Enhancements since the initial phases

- **Yield-curve history:** historical as-of curves (relative periods or exact
  dates) overlaid on the chart, with per-tenor basis-point change columns vs the
  current curve; show/hide controls in a settings popover; selection persists in
  `localStorage`.
- **Chart span/interval controls:** span (1D–5Y) and candle-interval (1m–1w)
  button rows on the chart widget, wired through Kraken and IBKR; invalid pairs are
  disabled to respect Kraken's 720-bar cap.
- **Expanded news sources:** Bloomberg, CNBC, Economist, and several X/Twitter
  market accounts (Nitter-bridged) added beyond the original FT/WSJ; the **All**
  view round-robins across sources so no single high-frequency feed dominates.
- **Follow people:** aggregated per-person feeds (news/video/blog/podcast) with a
  primary/on-topic curation filter and feed-wide dedupe.
