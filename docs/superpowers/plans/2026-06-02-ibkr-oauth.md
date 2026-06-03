# IBKR OAuth 1.0a Headless Sign-In — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully headless IBKR auth path (Web API OAuth 1.0a, via the `ibind` library for the auth handshake only) selectable alongside the existing Client Portal Gateway path, so equity quotes/charts/positions work without a manual browser login.

**Architecture:** A pluggable auth-transport inside `IbkrAdapter`. `GatewayTransport` keeps today's localhost behavior; `OAuthTransport` uses ibind to obtain a 24h live session token (LST) and sign each request, targeting `https://api.ibkr.com/v1/api`. The adapter's data methods (`get_quote/get_candles/get_positions`) and pure parsers are unchanged. Mode is chosen by config, defaulting to `oauth` when OAuth creds are present.

**Tech Stack:** Python 3.14, FastAPI, httpx, pydantic-settings, `ibind[oauth]` (v0.1.23). Frontend: Next.js + generated OpenAPI types.

**Spec:** `docs/superpowers/specs/2026-06-02-ibkr-oauth-design.md`

**Working directory:** Implement on a fresh worktree branched off `origin/main` (per the multi-agent worktree hazard). This plan's branch is `feat/ibkr-oauth`.

---

## File Structure

- `api/app/config.py` — **modify**: add OAuth settings + `ibkr_oauth_configured` / `resolve_ibkr_auth_mode` helpers.
- `api/app/adapters/ibkr_transport.py` — **create**: `IbkrTransport` base, `GatewayTransport`, `OAuthTransport`.
- `api/app/adapters/ibkr.py` — **modify**: select a transport lazily; delegate `_get/_post/_ensure_session` to it. Parsers + data methods unchanged.
- `api/app/models.py` — **modify**: `IbkrAuthResponse.login_url` → optional.
- `api/app/routers.py` — **modify**: `/ibkr/auth` returns `login_url=None` + OAuth-mode detail text in oauth mode.
- `api/requirements.in` / `requirements.txt` — **modify**: add `ibind[oauth]`.
- `api/.env.example` — **modify**: OAuth placeholders + portal-setup pointer.
- `.gitignore` — **modify**: ignore `api/secrets/`.
- `web/app/lib/api/schema.ts` — **regenerate**: `loginUrl` becomes nullable.
- `README.md` — **modify**: document the OAuth mode + portal setup.
- `api/tests/test_ibkr_oauth.py` — **create**: config resolver, transport selection, OAuthTransport (ibind mocked), auth-endpoint shape.

---

## Task 1: Config — OAuth settings + mode resolver

**Files:**
- Modify: `api/app/config.py`
- Test: `api/tests/test_ibkr_oauth.py` (create)

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_ibkr_oauth.py`:

```python
from app.config import Settings, resolve_ibkr_auth_mode


def _oauth_settings(**over):
    base = dict(
        ibkr_oauth_consumer_key="CONSUMER",
        ibkr_oauth_access_token="TOKEN",
        ibkr_oauth_access_token_secret="SECRET",
        ibkr_oauth_signature_key_path="/keys/sig.pem",
        ibkr_oauth_encryption_key_path="/keys/enc.pem",
        ibkr_oauth_dh_prime="ABCDEF",
    )
    base.update(over)
    return Settings(_env_file=None, **base)


def test_oauth_configured_true_when_all_present():
    assert _oauth_settings().ibkr_oauth_configured is True


def test_oauth_configured_false_when_any_missing():
    assert _oauth_settings(ibkr_oauth_dh_prime=None).ibkr_oauth_configured is False


def test_mode_defaults_to_oauth_when_configured():
    assert resolve_ibkr_auth_mode(_oauth_settings()) == "oauth"


def test_mode_defaults_to_gateway_when_not_configured():
    s = Settings(_env_file=None)
    assert resolve_ibkr_auth_mode(s) == "gateway"


def test_explicit_mode_overrides_default():
    s = _oauth_settings(ibkr_auth_mode="gateway")
    assert resolve_ibkr_auth_mode(s) == "gateway"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && ./.venv/bin/pytest tests/test_ibkr_oauth.py -v`
Expected: FAIL — `ImportError: cannot import name 'resolve_ibkr_auth_mode'`.

- [ ] **Step 3: Implement the settings + resolver**

In `api/app/config.py`, add to `Settings` (after the `ibkr_gateway_base_url` line):

```python
    # IBKR Web API OAuth 1.0a (headless). When all six are present, oauth mode
    # is selected by default; otherwise the gateway path is used. RSA key files
    # live in a gitignored api/secrets/ dir; only their paths are stored here.
    ibkr_auth_mode: str | None = None  # "oauth" | "gateway"; None => auto-resolve
    ibkr_oauth_consumer_key: str | None = None
    ibkr_oauth_access_token: str | None = None
    ibkr_oauth_access_token_secret: str | None = None
    ibkr_oauth_signature_key_path: str | None = None
    ibkr_oauth_encryption_key_path: str | None = None
    ibkr_oauth_dh_prime: str | None = None

    @property
    def ibkr_oauth_configured(self) -> bool:
        return all(
            (
                self.ibkr_oauth_consumer_key,
                self.ibkr_oauth_access_token,
                self.ibkr_oauth_access_token_secret,
                self.ibkr_oauth_signature_key_path,
                self.ibkr_oauth_encryption_key_path,
                self.ibkr_oauth_dh_prime,
            )
        )
```

Add a module-level function (after the `Settings` class, before `get_settings`):

```python
def resolve_ibkr_auth_mode(settings: "Settings") -> str:
    """Pick the IBKR auth mode: an explicit `ibkr_auth_mode` wins; otherwise
    default to "oauth" when OAuth creds are fully configured, else "gateway".
    """
    if settings.ibkr_auth_mode in ("oauth", "gateway"):
        return settings.ibkr_auth_mode
    return "oauth" if settings.ibkr_oauth_configured else "gateway"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && ./.venv/bin/pytest tests/test_ibkr_oauth.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add api/app/config.py api/tests/test_ibkr_oauth.py
git commit -m "feat(api): IBKR OAuth settings + auth-mode resolver"
```

---

## Task 2: Add the ibind dependency

**Files:**
- Modify: `api/requirements.in`, `api/requirements.txt`

- [ ] **Step 1: Add to `api/requirements.in`**

Append after `feedparser`:

```
ibind[oauth]
```

- [ ] **Step 2: Recompile the lockfile**

Run: `cd api && ./.venv/bin/pip-compile requirements.in -o requirements.txt`
Expected: `requirements.txt` updated to include `ibind`, plus its crypto deps (e.g. `pycryptodome`/`cryptography`, `requests`).

If `pip-compile` is unavailable, run: `cd api && ./.venv/bin/pip install pip-tools` first.

- [ ] **Step 3: Install into the venv**

Run: `cd api && ./.venv/bin/pip install -r requirements.txt`
Expected: ibind installs successfully.

- [ ] **Step 4: Verify import**

Run: `cd api && ./.venv/bin/python -c "from ibind.oauth.oauth1a import OAuth1aConfig, req_live_session_token, generate_oauth_headers; print('ok')"`
Expected: prints `ok`. If the import path differs in v0.1.23, note the correct path — it is used in Task 4.

- [ ] **Step 5: Commit**

```bash
git add api/requirements.in api/requirements.txt
git commit -m "build(api): add ibind[oauth] dependency"
```

---

## Task 3: Extract `GatewayTransport` (behavior-preserving refactor)

Move today's gateway logic into a transport class. No behavior change — the existing IBKR tests must stay green.

**Files:**
- Create: `api/app/adapters/ibkr_transport.py`
- Modify: `api/app/adapters/ibkr.py`

- [ ] **Step 1: Create the transport base + GatewayTransport**

Create `api/app/adapters/ibkr_transport.py`:

```python
"""Pluggable auth transports for the IBKR adapter.

The adapter's data methods call `get` / `post` / `ensure_session` on a transport,
so the choice between the local Client Portal Gateway and headless OAuth 1.0a is
isolated here. See docs/superpowers/specs/2026-06-02-ibkr-oauth-design.md.
"""

from __future__ import annotations

from typing import Any

import httpx

from ..http import get_json, post_form
from .base import SourceUnavailable, Unauthenticated


class IbkrTransport:
    """Base transport. Subclasses own the base URL, the httpx client, request
    auth, and session establishment. `get`/`post` return parsed JSON."""

    async def get(self, path: str, **kwargs: Any) -> Any:  # pragma: no cover
        raise NotImplementedError

    async def post(self, path: str, **kwargs: Any) -> Any:  # pragma: no cover
        raise NotImplementedError

    async def ensure_session(self) -> None:  # pragma: no cover
        raise NotImplementedError


class GatewayTransport(IbkrTransport):
    """Local Client Portal Gateway: self-signed cert (TLS verify OFF for this
    localhost client ONLY), browser-established session kept alive via /tickle."""

    def __init__(self, base_url: str) -> None:
        self._base = base_url.rstrip("/")
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._base, verify=False, timeout=httpx.Timeout(10.0, connect=4.0)
            )
        return self._client

    async def get(self, path: str, **kwargs: Any) -> Any:
        return await get_json(path, source="ibkr", client=self._http(), **kwargs)

    async def post(self, path: str, **kwargs: Any) -> Any:
        data = kwargs.pop("data", {})
        return await post_form(path, source="ibkr", data=data, client=self._http(), **kwargs)

    async def ensure_session(self) -> None:
        try:
            data = await self.post("/tickle")
        except Unauthenticated as exc:
            raise Unauthenticated(
                "Log in at the IBKR gateway in your browser, then retry."
            ) from exc
        except SourceUnavailable as exc:
            raise SourceUnavailable(
                "IBKR gateway is not reachable — is the Client Portal Gateway running?"
            ) from exc
        auth = (((data or {}).get("iserver") or {}).get("authStatus") or {}).get("authenticated")
        if auth is None:
            status = await self.get("/iserver/auth/status")
            auth = (status or {}).get("authenticated")
        if not auth:
            raise Unauthenticated("Log in at the IBKR gateway in your browser, then retry.")
```

- [ ] **Step 2: Point `IbkrAdapter` at the transport**

In `api/app/adapters/ibkr.py`:

Add import near the top (after `from .base import ...`):

```python
from .ibkr_transport import GatewayTransport, IbkrTransport
```

Replace the adapter's `__init__`, `_gateway`, `_get`, `_post`, `_ensure_session` with transport delegation. The new `__init__`:

```python
    def __init__(self) -> None:
        self._transport: IbkrTransport | None = None
        self._conids: dict[str, str] = {}
        self._primed = False

    def _t(self) -> IbkrTransport:
        if self._transport is None:
            self._transport = self._build_transport()
        return self._transport

    def _build_transport(self) -> IbkrTransport:
        from ..config import get_settings

        return GatewayTransport(get_settings().ibkr_gateway_base_url)

    async def _get(self, path: str, **kwargs: Any) -> Any:
        return await self._t().get(path, **kwargs)

    async def _post(self, path: str, **kwargs: Any) -> Any:
        return await self._t().post(path, **kwargs)

    async def _ensure_session(self) -> None:
        await self._t().ensure_session()
```

Delete the now-moved body of the old `_ensure_session` (the tickle/auth-status logic now lives in `GatewayTransport.ensure_session`). Keep `get_auth_state`, `_prime`, `_resolve_conid`, `get_quote`, `get_positions`, `get_candles`, and all parsers exactly as they are — they call `self._get/_post/_ensure_session`.

Remove the now-unused `httpx` import only if nothing else in `ibkr.py` uses it (the parsers/`_num` do not; verify with a grep before deleting).

- [ ] **Step 3: Run the existing IBKR tests**

Run: `cd api && ./.venv/bin/pytest -k ibkr -v`
Expected: PASS — all prior IBKR adapter tests still pass (behavior unchanged).

- [ ] **Step 4: Run the full backend suite**

Run: `cd api && ./.venv/bin/pytest`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/ibkr_transport.py api/app/adapters/ibkr.py
git commit -m "refactor(api): extract IBKR GatewayTransport (no behavior change)"
```

---

## Task 4: Implement `OAuthTransport`

ibind obtains the LST and signs requests; our httpx makes the data calls. The exact ibind call shapes are verified first (it's a beta lib; master vs v0.1.23 may differ).

**Files:**
- Modify: `api/app/adapters/ibkr_transport.py`
- Test: `api/tests/test_ibkr_oauth.py`

- [ ] **Step 1: Verify the ibind handshake API against the installed version**

Run a REPL probe and record the exact signatures:

Run:
```bash
cd api && ./.venv/bin/python - <<'PY'
import inspect
from ibind.oauth import oauth1a as m
for n in ("OAuth1aConfig", "req_live_session_token", "generate_oauth_headers"):
    obj = getattr(m, n)
    print(n, "->", inspect.signature(obj) if callable(obj) else type(obj))
PY
```
Expected: prints the signatures. Confirm: `OAuth1aConfig(consumer_key, access_token, access_token_secret, dh_prime, encryption_key_fp, signature_key_fp, ...)`, `req_live_session_token(client, oauth_config)` returning a 3-tuple `(live_session_token, expires_ms, lst_signature)`, and `generate_oauth_headers(oauth_config, request_method, request_url, live_session_token=..., request_params=..., signature_method=...)`. If any differ, use the printed signatures in Step 3 (the structure below stays the same; only argument names/imports change).

- [ ] **Step 2: Write the failing test (ibind fully mocked — no secrets, no network)**

Append to `api/tests/test_ibkr_oauth.py`:

```python
import asyncio
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.adapters.ibkr_transport import OAuthTransport
from app.adapters.base import Unauthenticated


def _oauth_cfg():
    return SimpleNamespace(consumer_key="C", access_token="T")


def test_oauth_transport_signs_and_gets(monkeypatch):
    t = OAuthTransport(_oauth_cfg())
    # Pretend a live session token already exists and the brokerage session is up.
    t._lst = "LST"
    t._lst_expires_ms = 10**18
    t._brokerage_ready = True

    captured = {}

    async def fake_get_json(path, *, source, client, **kwargs):
        captured["path"] = path
        captured["headers"] = kwargs.get("headers")
        return [{"31": "100.0"}]

    monkeypatch.setattr("app.adapters.ibkr_transport.get_json", fake_get_json)
    monkeypatch.setattr(
        "app.adapters.ibkr_transport.generate_oauth_headers",
        lambda **kw: {"Authorization": "OAuth oauth_signature=sig"},
    )

    out = asyncio.run(t.get("/iserver/marketdata/snapshot", params={"conids": "1"}))
    assert out == [{"31": "100.0"}]
    assert captured["path"] == "/iserver/marketdata/snapshot"
    assert captured["headers"]["Authorization"].startswith("OAuth ")


def test_oauth_ensure_session_fetches_lst_and_inits_brokerage(monkeypatch):
    t = OAuthTransport(_oauth_cfg())

    monkeypatch.setattr(
        "app.adapters.ibkr_transport.req_live_session_token",
        lambda client, cfg: ("LST", 10**18, "sigxyz"),
    )
    monkeypatch.setattr(
        "app.adapters.ibkr_transport.generate_oauth_headers",
        lambda **kw: {"Authorization": "OAuth x"},
    )

    posts = []

    async def fake_post_form(path, *, source, data, client=None, **kwargs):
        posts.append(path)
        if path.endswith("/ssodh/init"):
            return {"authenticated": True, "connected": True}
        return {}  # /tickle

    monkeypatch.setattr("app.adapters.ibkr_transport.post_form", fake_post_form)
    monkeypatch.setattr(OAuthTransport, "_ibind_client", lambda self: object())

    asyncio.run(t.ensure_session())
    assert t._lst == "LST"
    assert t._brokerage_ready is True
    assert any(p.endswith("/ssodh/init") for p in posts)
```

- [ ] **Step 3: Implement `OAuthTransport`**

In `api/app/adapters/ibkr_transport.py`, add the imports at the top:

```python
import time

from ibind.oauth.oauth1a import (
    generate_oauth_headers,
    req_live_session_token,
)
```

(Use the exact import path confirmed in Step 1.)

Then add the class:

```python
class OAuthTransport(IbkrTransport):
    """Headless Web API OAuth 1.0a. ibind performs the auth handshake (live
    session token + request signing); our httpx makes the actual data calls to
    api.ibkr.com. Holds a 24h LST and a brokerage session (ssodh/init)."""

    BASE = "https://api.ibkr.com/v1/api"

    def __init__(self, oauth_config: Any) -> None:
        self._oauth = oauth_config
        self._client: httpx.AsyncClient | None = None
        self._lst: str | None = None
        self._lst_expires_ms: int = 0
        self._brokerage_ready = False

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            # Real (CA-signed) endpoint: keep TLS verification ON.
            self._client = httpx.AsyncClient(
                base_url=self.BASE, timeout=httpx.Timeout(10.0, connect=5.0)
            )
        return self._client

    def _ibind_client(self) -> Any:
        # Minimal ibind client used ONLY to perform the LST handshake.
        from ibind import IbkrClient

        return IbkrClient(use_oauth=True, oauth_config=self._oauth)

    def _headers(self, method: str, path: str, params: dict | None = None) -> dict[str, str]:
        return generate_oauth_headers(
            oauth_config=self._oauth,
            request_method=method,
            request_url=f"{self.BASE}{path}",
            live_session_token=self._lst,
            request_params=params,
            signature_method="HMAC-SHA256",
        )

    async def get(self, path: str, **kwargs: Any) -> Any:
        params = kwargs.get("params")
        headers = {**self._headers("GET", path, params), **kwargs.pop("headers", {})}
        return await get_json(path, source="ibkr", client=self._http(), headers=headers, **kwargs)

    async def post(self, path: str, **kwargs: Any) -> Any:
        data = kwargs.pop("data", {})
        headers = {**self._headers("POST", path, data or None), **kwargs.pop("headers", {})}
        return await post_form(path, source="ibkr", data=data, client=self._http(), headers=headers)

    def _lst_valid(self) -> bool:
        return bool(self._lst) and self._lst_expires_ms > int(time.time() * 1000) + 60_000

    async def ensure_session(self) -> None:
        if not self._lst_valid():
            try:
                lst, expires_ms, _sig = req_live_session_token(self._ibind_client(), self._oauth)
            except Exception as exc:  # noqa: BLE001 — bad creds/signature => actionable state
                self._brokerage_ready = False
                raise Unauthenticated(
                    "IBKR OAuth credentials were rejected — check api/.env."
                ) from exc
            self._lst = lst
            self._lst_expires_ms = int(expires_ms)
            self._brokerage_ready = False
        if not self._brokerage_ready:
            # Initialize the brokerage session for iserver endpoints, then confirm.
            await self.post("/iserver/auth/ssodh/init", data={"publish": "true", "compete": "true"})
            await self.post("/tickle")
            self._brokerage_ready = True
```

- [ ] **Step 4: Run the tests**

Run: `cd api && ./.venv/bin/pytest tests/test_ibkr_oauth.py -v`
Expected: PASS (all config + OAuthTransport tests).

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/ibkr_transport.py api/tests/test_ibkr_oauth.py
git commit -m "feat(api): IBKR OAuthTransport (ibind handshake + signed httpx calls)"
```

---

## Task 5: Select the transport by config

**Files:**
- Modify: `api/app/adapters/ibkr.py`
- Test: `api/tests/test_ibkr_oauth.py`

- [ ] **Step 1: Write the failing test**

Append to `api/tests/test_ibkr_oauth.py`:

```python
from app.adapters.ibkr import IbkrAdapter
from app.adapters.ibkr_transport import GatewayTransport, OAuthTransport


def test_adapter_builds_gateway_transport_by_default(monkeypatch):
    monkeypatch.setattr("app.config.get_settings", lambda: Settings(_env_file=None))
    a = IbkrAdapter()
    assert isinstance(a._build_transport(), GatewayTransport)


def test_adapter_builds_oauth_transport_when_configured(monkeypatch):
    monkeypatch.setattr("app.config.get_settings", lambda: _oauth_settings())
    # Avoid constructing a real ibind config / reading key files in this unit test.
    monkeypatch.setattr(
        "app.adapters.ibkr._make_oauth_config", lambda s: SimpleNamespace(consumer_key="C")
    )
    a = IbkrAdapter()
    assert isinstance(a._build_transport(), OAuthTransport)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && ./.venv/bin/pytest tests/test_ibkr_oauth.py -k transport -v`
Expected: FAIL — `_make_oauth_config` undefined / OAuth branch missing.

- [ ] **Step 3: Implement transport selection**

In `api/app/adapters/ibkr.py`, update the import and `_build_transport`, and add `_make_oauth_config`:

```python
from .ibkr_transport import GatewayTransport, IbkrTransport, OAuthTransport
```

```python
def _make_oauth_config(settings: Any) -> Any:
    """Build ibind's OAuth1aConfig from settings. Imported lazily so the app
    boots without ibind when only the gateway path is used."""
    from ibind.oauth.oauth1a import OAuth1aConfig

    return OAuth1aConfig(
        consumer_key=settings.ibkr_oauth_consumer_key,
        access_token=settings.ibkr_oauth_access_token,
        access_token_secret=settings.ibkr_oauth_access_token_secret,
        dh_prime=settings.ibkr_oauth_dh_prime,
        encryption_key_fp=settings.ibkr_oauth_encryption_key_path,
        signature_key_fp=settings.ibkr_oauth_signature_key_path,
    )
```

```python
    def _build_transport(self) -> IbkrTransport:
        from ..config import get_settings, resolve_ibkr_auth_mode

        settings = get_settings()
        if resolve_ibkr_auth_mode(settings) == "oauth":
            return OAuthTransport(_make_oauth_config(settings))
        return GatewayTransport(settings.ibkr_gateway_base_url)
```

(Confirm `OAuth1aConfig`'s exact field names against Step 1 of Task 4; adjust if the installed version differs.)

- [ ] **Step 4: Run the tests**

Run: `cd api && ./.venv/bin/pytest tests/test_ibkr_oauth.py -v`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `cd api && ./.venv/bin/pytest`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add api/app/adapters/ibkr.py api/tests/test_ibkr_oauth.py
git commit -m "feat(api): select IBKR transport by auth mode"
```

---

## Task 6: Auth endpoint — optional login_url + OAuth-mode detail

**Files:**
- Modify: `api/app/models.py`, `api/app/routers.py`
- Test: `api/tests/test_ibkr_oauth.py`

- [ ] **Step 1: Write the failing test**

Append to `api/tests/test_ibkr_oauth.py`:

```python
from fastapi.testclient import TestClient
from app.main import app  # adjust if the FastAPI app lives elsewhere


def test_ibkr_auth_oauth_mode_has_null_login_url(monkeypatch):
    monkeypatch.setattr("app.routers.get_settings", lambda: _oauth_settings())
    monkeypatch.setattr("app.routers.resolve_ibkr_auth_mode", lambda s: "oauth")

    async def fake_state(self):
        return "unauthenticated"

    monkeypatch.setattr("app.adapters.ibkr.IbkrAdapter.get_auth_state", fake_state)

    client = TestClient(app)
    body = client.get("/ibkr/auth").json()
    assert body["loginUrl"] is None
    assert "credential" in body["detail"].lower() or "api/.env" in body["detail"]
```

(If `app.main` / route prefix differ, mirror an existing router test in `api/tests/`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && ./.venv/bin/pytest tests/test_ibkr_oauth.py -k login_url -v`
Expected: FAIL — `loginUrl` is a non-null string (current behavior) or validation error.

- [ ] **Step 3: Make `login_url` optional**

In `api/app/models.py`, change `IbkrAuthResponse`:

```python
class IbkrAuthResponse(CamelModel):
    state: IbkrAuthState
    login_url: str | None = None
    detail: str
```

- [ ] **Step 4: Branch the endpoint on mode**

In `api/app/routers.py`, add to the imports from config:

```python
from .config import get_settings, resolve_ibkr_auth_mode
```

Add an OAuth detail map near `_IBKR_DETAIL`:

```python
_IBKR_OAUTH_DETAIL: dict[str, str] = {
    "authenticated": "Connected to IBKR via OAuth.",
    "unauthenticated": "IBKR OAuth credentials were rejected — check api/.env.",
    "unreachable": "IBKR API (api.ibkr.com) is unreachable.",
}
```

Update `ibkr_auth()`:

```python
@router.get("/ibkr/auth", response_model=IbkrAuthResponse, tags=["meta"])
async def ibkr_auth() -> IbkrAuthResponse:
    settings = get_settings()
    mode = resolve_ibkr_auth_mode(settings)
    adapter = _adapter("ibkr")
    if not isinstance(adapter, IbkrAdapter):
        return IbkrAuthResponse(
            state="unreachable", login_url=None, detail="IBKR integration not available."
        )
    state = await adapter.get_auth_state()
    if mode == "oauth":
        return IbkrAuthResponse(state=state, login_url=None, detail=_IBKR_OAUTH_DETAIL[state])
    login_url = gateway_login_url(settings.ibkr_gateway_base_url)
    return IbkrAuthResponse(state=state, login_url=login_url, detail=_IBKR_DETAIL[state])
```

- [ ] **Step 5: Run the tests**

Run: `cd api && ./.venv/bin/pytest tests/test_ibkr_oauth.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/app/models.py api/app/routers.py api/tests/test_ibkr_oauth.py
git commit -m "feat(api): OAuth-mode IBKR auth state (null login_url + detail)"
```

---

## Task 7: Frontend — regenerate types, verify null handling

**Files:**
- Regenerate: `web/app/lib/api/schema.ts`
- Verify: `web/app/components/IbkrLoginButton.tsx`, `IbkrAuthProvider.tsx`

- [ ] **Step 1: Start the backend**

Run (in a separate shell): `cd api && ./.venv/bin/uvicorn app.main:app --port 8000`
Expected: serves `http://127.0.0.1:8000/openapi.json`.

- [ ] **Step 2: Regenerate the OpenAPI types**

Run: `cd web && npm run gen:api`
Expected: `app/lib/api/schema.ts` updates `loginUrl` to `string | null`.

- [ ] **Step 3: Confirm no code change is needed in the button**

`IbkrLoginButton` already returns `null` when `loginUrl` is falsy (`if (!loginUrl) return null;`), and `IbkrAuthProvider` already types `loginUrl` as `string | null`. So in OAuth mode (null), no login button renders — verify by reading both files; no edit expected.

- [ ] **Step 4: Typecheck, test, build**

Run: `cd web && npm test && npm run lint && npm run build`
Expected: tests pass, lint clean, build succeeds. If the build flags a `loginUrl` type mismatch anywhere, that's the type contract working — fix the call site to accept `string | null`.

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/api/schema.ts
git commit -m "feat(web): regenerate API types — IBKR loginUrl now nullable"
```

---

## Task 8: Config docs — .env.example, .gitignore, README

**Files:**
- Modify: `api/.env.example`, `.gitignore`, `README.md`

- [ ] **Step 1: Add OAuth placeholders to `api/.env.example`**

Append under the IBKR section:

```
# --- IBKR Web API OAuth 1.0a (headless; alternative to the gateway) ---
# When all six are set, oauth mode is selected automatically. Generate these in
# the IBKR self-service portal: register an OAuth consumer (consumer key),
# generate two RSA key pairs (signature + encryption) and upload the public keys,
# mint an access token + secret, and obtain the Diffie-Hellman prime.
# Force a mode explicitly with IBKR_AUTH_MODE=oauth|gateway (optional).
# IBKR_AUTH_MODE=
# IBKR_OAUTH_CONSUMER_KEY=
# IBKR_OAUTH_ACCESS_TOKEN=
# IBKR_OAUTH_ACCESS_TOKEN_SECRET=
# IBKR_OAUTH_SIGNATURE_KEY_PATH=api/secrets/signature.pem
# IBKR_OAUTH_ENCRYPTION_KEY_PATH=api/secrets/encryption.pem
# IBKR_OAUTH_DH_PRIME=
```

- [ ] **Step 2: Gitignore the key directory**

Append to `.gitignore`:

```
# IBKR OAuth RSA private keys — never commit
api/secrets/
```

- [ ] **Step 3: Document in README**

In `README.md`, under the IBKR setup section, add a short subsection explaining the two modes: gateway (existing) and OAuth (headless, no browser login, routes to api.ibkr.com), the six env vars, where key files live (`api/secrets/`), and that OAuth removes the deployment caveat. Reference the spec.

- [ ] **Step 4: Commit**

```bash
git add api/.env.example .gitignore README.md
git commit -m "docs: document IBKR OAuth mode + ignore api/secrets"
```

---

## Task 9: Manual live verification (no CI)

End-to-end signing can only be confirmed against IBKR with real credentials. Do this after Tasks 1–8, with portal setup complete.

- [ ] **Step 1: Place credentials**

Put the RSA key files in `api/secrets/` and the six `IBKR_OAUTH_*` values in `api/.env`. Leave `IBKR_AUTH_MODE` unset (auto → oauth).

- [ ] **Step 2: Start backend, check auth state**

Run: `cd api && ./.venv/bin/uvicorn app.main:app --port 8000`
Run: `curl -s http://127.0.0.1:8000/ibkr/auth | python -m json.tool`
Expected: `{"state": "authenticated", "loginUrl": null, "detail": "Connected to IBKR via OAuth."}` once the brokerage session initializes. On bad creds: `state: "unauthenticated"` with the "check api/.env" detail (never a crash).

- [ ] **Step 3: Pull live data**

Run: `curl -s "http://127.0.0.1:8000/quote/AAPL" | python -m json.tool`
Expected: a populated `Quote` (`last` set, `stale: false` if entitled). Then `curl -s http://127.0.0.1:8000/portfolio` and confirm positions.

- [ ] **Step 4: Confirm the frontend UX**

Run the app; open Settings → Connections. The IBKR dot is green and **no "Open gateway login" button appears** (OAuth mode). With deliberately-wrong creds, the dot reflects `unauthenticated` and the detail says to check `api/.env` — no dead login link.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/ibkr-oauth
gh pr create --base main --title "feat: headless IBKR sign-in via OAuth 1.0a" \
  --body "Implements docs/superpowers/specs/2026-06-02-ibkr-oauth-design.md. Config-selected oauth|gateway transport; ibind for the auth handshake only; data path + parsers unchanged. Manual live verification completed."
```

---

## Self-Review

- **Spec coverage:** pluggable transport (T3–T5); ibind auth-only (T4); mode selection + default (T1, T5); config/secrets in api/.env + api/secrets/ (T1, T8); auth-state remap + optional login_url + frontend (T6, T7); error handling via existing http.py mapping (T4 ensure_session → Unauthenticated/SourceUnavailable); testing unit+manual (T1,4,5,6 + T9); YAGNI (no order entry/OAuth2/IBeam — nothing added). Covered.
- **Placeholder scan:** none — every code step shows the code; the two ibind-API uncertainties are handled by an explicit REPL verification step (T2.S4, T4.S1) with concrete fallback instructions, not vague "handle it later."
- **Type consistency:** `IbkrTransport.get/post/ensure_session` used identically in `GatewayTransport`, `OAuthTransport`, and `IbkrAdapter._get/_post/_ensure_session`. `OAuth1aConfig` field names (`encryption_key_fp`, `signature_key_fp`, `dh_prime`) consistent between `_make_oauth_config` (T5) and the verified ibind signature (T4.S1). `resolve_ibkr_auth_mode` / `ibkr_oauth_configured` names consistent across T1, T5, T6. `login_url: str | None` consistent across model (T6), endpoint (T6), and regenerated TS (T7).
