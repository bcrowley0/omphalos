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

Open <http://localhost:3000>. The page fetches `/api/health` through the proxy and
renders the backend's response, with explicit loading / error states and an
on-demand **refresh** button.

## Dependency management

- **Frontend:** npm. `web/package-lock.json` is the committed lockfile.
- **Backend:** [pip-tools]. Top-level deps live in `api/requirements.in`; the pinned
  lockfile `api/requirements.txt` is generated with:
  ```bash
  ./.venv/bin/pip-compile requirements.in -o requirements.txt
  ```
  Install from the lockfile with `pip install -r requirements.txt`.

## Secrets

Secrets live **only** in `api/.env` (gitignored), loaded via pydantic-settings.
`api/.env.example` documents the variables with placeholders. No secret ever lives
in frontend code or in git.

## Notes for later phases

- **IBKR (Phase 5):** integration uses IBKR's Client Portal Gateway, a local Java
  program you log into through the browser on the same machine. The gateway uses a
  self-signed cert (TLS verification is disabled for the localhost gateway only).
  Its same-machine manual browser login will complicate any future server
  deployment.

## Status

Built in phases (see `PROMPT.md`). **Phase 0 (scaffold) is complete:** monorepo,
health-check round-trip through the proxy, git hygiene, pinned versions, committed
lockfiles.

[pip-tools]: https://github.com/jazzband/pip-tools
