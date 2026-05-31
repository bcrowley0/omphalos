# IBKR Easy-Connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make connecting to IBKR a one-click action — a live auth-state endpoint drives a global "log in" banner on load, a button + live status dot in Settings, and an inline login button in the Portfolio widget.

**Architecture:** A new non-throwing backend endpoint `GET /ibkr/auth` reports `authenticated | unauthenticated | unreachable` plus a config-derived `loginUrl`. The frontend regenerates its OpenAPI types, then a shared React context (`IbkrAuthProvider`) fetches that state once (on mount, on window focus, and on manual re-check) and feeds three surfaces: a global banner, the Settings → Connections row, and the Portfolio widget. Clicking "Open gateway login" opens the gateway's own login page in a new tab on a real user click (so the popup blocker never fires).

**Tech Stack:** FastAPI + Pydantic (`api/`), Next.js + React 19 + TypeScript (`web/`), pytest (backend), vitest (frontend), openapi-typescript for type generation.

**Spec:** `docs/superpowers/specs/2026-05-31-ibkr-easy-connect-design.md`

---

## File Structure

**Backend (`api/`):**
- Modify `app/adapters/ibkr.py` — add pure `gateway_login_url()` helper + `IbkrAdapter.get_auth_state()` method.
- Modify `app/models.py` — add `IbkrAuthState` literal + `IbkrAuthResponse` model.
- Modify `app/routers.py` — add `GET /ibkr/auth` endpoint.
- Create `tests/test_ibkr_auth.py` — tests for the helper, method, and endpoint.

**Frontend (`web/`):**
- Modify `app/lib/api/schema.ts` — regenerated (not hand-edited).
- Create `app/lib/ibkrAuth.ts` — loader + pure `ibkrBannerVisible()` / `ibkrDotColor()` helpers.
- Create `app/lib/ibkrAuth.test.ts` — tests for the pure helpers.
- Create `app/components/IbkrAuthProvider.tsx` — React context + `useIbkrAuth()` hook (mount + focus re-check).
- Create `app/components/IbkrLoginButton.tsx` — shared "Open gateway login" + "Re-check" buttons.
- Create `app/components/IbkrAuthBanner.tsx` — the global banner.
- Modify `app/components/Terminal.tsx` — wrap in provider, render banner.
- Modify `app/widgets/SettingsWidget.tsx` — live IBKR dot + buttons in Connections.
- Modify `app/widgets/PortfolioWidget.tsx` — inline login button when IBKR is unauthenticated.

---

## Task 1: Pure `gateway_login_url()` helper (backend)

Derives the gateway's login origin from the configured base URL, so the frontend never hardcodes it.

**Files:**
- Modify: `api/app/adapters/ibkr.py`
- Test: `api/tests/test_ibkr_auth.py` (create)

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_ibkr_auth.py`:

```python
"""Tests for the IBKR connection-status helper, adapter method, and endpoint."""

import httpx
import pytest

from app.adapters.ibkr import IbkrAdapter, gateway_login_url


def test_gateway_login_url_strips_v1_api_path():
    assert gateway_login_url("https://localhost:5000/v1/api") == "https://localhost:5000"


def test_gateway_login_url_preserves_host_and_port():
    assert gateway_login_url("https://127.0.0.1:5001/v1/api") == "https://127.0.0.1:5001"


def test_gateway_login_url_tolerates_trailing_slash():
    assert gateway_login_url("https://localhost:5000/v1/api/") == "https://localhost:5000"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_ibkr_auth.py -v`
Expected: FAIL with `ImportError: cannot import name 'gateway_login_url'`

- [ ] **Step 3: Write minimal implementation**

In `api/app/adapters/ibkr.py`, add `import urllib.parse` to the imports block (after `import re`):

```python
import asyncio
import re
import urllib.parse
from typing import Any
```

Then add this pure function near the other module-level helpers (e.g. directly above `def pick_primary_conid`):

```python
def gateway_login_url(base_url: str) -> str:
    """Origin (scheme://host[:port]) of the gateway base URL — the page the user
    logs in at. Strips the '/v1/api' path so config stays the single source of
    truth for the gateway location. Pure/testable.
    """
    parts = urllib.parse.urlsplit(base_url)
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, "", "", ""))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_ibkr_auth.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/ibkr.py api/tests/test_ibkr_auth.py
git commit -m "feat(ibkr): add gateway_login_url helper"
```

---

## Task 2: `IbkrAuthState` + `IbkrAuthResponse` model (backend)

The response shape for the new endpoint. `state` is a `Literal` so the generated TS type is a precise union.

**Files:**
- Modify: `api/app/models.py:14` (imports) and end of file
- Test: covered indirectly by Task 3's endpoint test (no separate model test needed — it's a plain data shape)

- [ ] **Step 1: Add the `Literal` import**

In `api/app/models.py`, change the top imports (currently `from enum import Enum`) to add `Literal`:

```python
from enum import Enum
from typing import Literal
```

- [ ] **Step 2: Add the model at the end of the file**

Append to `api/app/models.py` (after `KeysUpdateRequest`):

```python
# --------------------------------------------------------------------------- #
# IBKR live connection state — drives the one-click "log in at the gateway" UX.
# `loginUrl` is derived from IBKR_GATEWAY_BASE_URL on the backend so the frontend
# never hardcodes the gateway location. Carries no secrets.
# --------------------------------------------------------------------------- #
IbkrAuthState = Literal["authenticated", "unauthenticated", "unreachable"]


class IbkrAuthResponse(CamelModel):
    state: IbkrAuthState
    login_url: str
    detail: str
```

- [ ] **Step 3: Verify it imports cleanly**

Run: `cd api && python -c "from app.models import IbkrAuthResponse, IbkrAuthState; print(IbkrAuthResponse(state='unreachable', login_url='https://localhost:5000', detail='x').model_dump(by_alias=True))"`
Expected: prints `{'state': 'unreachable', 'loginUrl': 'https://localhost:5000', 'detail': 'x'}` (note camelCase `loginUrl`)

- [ ] **Step 4: Commit**

```bash
git add api/app/models.py
git commit -m "feat(ibkr): add IbkrAuthResponse model"
```

---

## Task 3: `IbkrAdapter.get_auth_state()` + `GET /ibkr/auth` endpoint (backend)

`get_auth_state()` reuses the existing `_ensure_session()` state machine but **returns** the three states instead of raising. The endpoint wraps it and adds the login URL + human detail.

**Files:**
- Modify: `api/app/adapters/ibkr.py` (add method to `IbkrAdapter`)
- Modify: `api/app/routers.py` (imports + endpoint)
- Test: `api/tests/test_ibkr_auth.py`

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_ibkr_auth.py`:

```python
def _adapter(handler) -> IbkrAdapter:
    a = IbkrAdapter()
    a._client = httpx.AsyncClient(
        base_url="https://gw.local/v1/api", transport=httpx.MockTransport(handler)
    )
    return a


async def test_get_auth_state_authenticated():
    a = _adapter(lambda req: httpx.Response(200, json={"iserver": {"authStatus": {"authenticated": True}}}))
    assert await a.get_auth_state() == "authenticated"


async def test_get_auth_state_unauthenticated_when_not_logged_in():
    a = _adapter(lambda req: httpx.Response(200, json={"iserver": {"authStatus": {"authenticated": False}}}))
    assert await a.get_auth_state() == "unauthenticated"


async def test_get_auth_state_unreachable_on_connect_error():
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=req)

    a = _adapter(handler)
    assert await a.get_auth_state() == "unreachable"


def test_ibkr_auth_endpoint_reports_state_and_login_url(monkeypatch):
    from fastapi.testclient import TestClient

    from app.adapters.ibkr import IbkrAdapter as RealAdapter
    from app.main import app

    async def fake_state(self):
        return "unauthenticated"

    monkeypatch.setattr(RealAdapter, "get_auth_state", fake_state)
    r = TestClient(app).get("/ibkr/auth")
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "unauthenticated"
    assert body["loginUrl"] == "https://localhost:5000"  # from default IBKR_GATEWAY_BASE_URL
    assert isinstance(body["detail"], str) and body["detail"]


def test_ibkr_auth_endpoint_never_500s_when_unreachable(monkeypatch):
    from fastapi.testclient import TestClient

    from app.adapters.ibkr import IbkrAdapter as RealAdapter
    from app.main import app

    async def fake_state(self):
        return "unreachable"

    monkeypatch.setattr(RealAdapter, "get_auth_state", fake_state)
    r = TestClient(app).get("/ibkr/auth")
    assert r.status_code == 200
    assert r.json()["state"] == "unreachable"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && python -m pytest tests/test_ibkr_auth.py -v`
Expected: FAIL — `AttributeError: 'IbkrAdapter' object has no attribute 'get_auth_state'` and 404 on `/ibkr/auth`

- [ ] **Step 3a: Add `get_auth_state()` to the adapter**

In `api/app/adapters/ibkr.py`, update the models import line to add `IbkrAuthState`:

```python
from ..models import Candle, IbkrAuthState, Interval, Position, Quote, Span
```

Then add this method to the `IbkrAdapter` class, directly after `_ensure_session` (after its final line `raise Unauthenticated("Log in at the IBKR gateway in your browser, then retry.")`):

```python
    async def get_auth_state(self) -> IbkrAuthState:
        """Probe the gateway and return one of the three connection states without
        raising — backs the /ibkr/auth status endpoint. Reuses _ensure_session's
        state machine: it raises for the not-connected states, which we translate
        to plain string states here.
        """
        try:
            await self._ensure_session()
        except Unauthenticated:
            return "unauthenticated"
        except SourceUnavailable:
            return "unreachable"
        return "authenticated"
```

- [ ] **Step 3b: Add the endpoint to the router**

In `api/app/routers.py`, add imports. After the existing `from .adapters.people import ...` line, add:

```python
from .adapters.ibkr import IbkrAdapter, gateway_login_url
```

In the `from .models import (...)` block, add `IbkrAuthResponse` (keep alphabetical-ish ordering near the others):

```python
    FollowItem,
    IbkrAuthResponse,
    Interval,
```

Then add this endpoint at the end of `api/app/routers.py` (after `update_keys`):

```python
# --------------------------------------------------------------------------- #
# IBKR live connection state — one-click "log in at the gateway" UX. Never
# raises (get_auth_state maps every failure to a state); loginUrl is derived
# from config so the frontend never hardcodes the gateway location.
# --------------------------------------------------------------------------- #
_IBKR_DETAIL: dict[str, str] = {
    "authenticated": "Connected to the IBKR gateway.",
    "unauthenticated": "Gateway is running, but you're not logged in.",
    "unreachable": "IBKR gateway not reachable — is the Client Portal Gateway running?",
}


@router.get("/ibkr/auth", response_model=IbkrAuthResponse, tags=["meta"])
async def ibkr_auth() -> IbkrAuthResponse:
    login_url = gateway_login_url(get_settings().ibkr_gateway_base_url)
    adapter = _adapter("ibkr")
    if not isinstance(adapter, IbkrAdapter):
        return IbkrAuthResponse(
            state="unreachable", login_url=login_url, detail="IBKR integration not available."
        )
    state = await adapter.get_auth_state()
    return IbkrAuthResponse(state=state, login_url=login_url, detail=_IBKR_DETAIL[state])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && python -m pytest tests/test_ibkr_auth.py -v`
Expected: PASS (8 passed)

- [ ] **Step 5: Run the full backend suite (no regressions)**

Run: `cd api && python -m pytest -q`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add api/app/adapters/ibkr.py api/app/routers.py api/tests/test_ibkr_auth.py
git commit -m "feat(ibkr): add GET /ibkr/auth live connection-state endpoint"
```

---

## Task 4: Regenerate frontend OpenAPI types

The TS client/types are GENERATED from the backend OpenAPI schema (CLAUDE.md type contract — no hand-written duplicates). This makes `Schemas["IbkrAuthResponse"]` available.

**Files:**
- Modify: `web/app/lib/api/schema.ts` (regenerated, do NOT hand-edit)

- [ ] **Step 1: Start the backend on :8000**

If the repo has a dev launcher (e.g. `./go.sh` or `./dev.sh`), use it. Otherwise start uvicorn in the background:

Run: `cd api && (python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &) && sleep 3 && curl -s http://127.0.0.1:8000/openapi.json | head -c 80`
Expected: prints the start of the OpenAPI JSON (confirms the server is up)

- [ ] **Step 2: Regenerate the schema**

Run: `cd web && npm run gen:api`
Expected: `app/lib/api/schema.ts` is rewritten with no errors

- [ ] **Step 3: Verify the new type is present**

Run: `cd web && grep -c "IbkrAuthResponse" app/lib/api/schema.ts`
Expected: a count ≥ 1 (the model and the `/ibkr/auth` path reference it)

- [ ] **Step 4: Stop the backend**

Run: `pkill -f "uvicorn app.main:app" || true`
Expected: backend process stops (ignore "no process found" if you used a shared launcher you want to keep running)

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/api/schema.ts
git commit -m "chore(web): regenerate OpenAPI types for /ibkr/auth"
```

---

## Task 5: Frontend `ibkrAuth.ts` loader + pure helpers

The loader and two pure presentation helpers, unit-tested like the rest of `app/lib`.

**Files:**
- Create: `web/app/lib/ibkrAuth.ts`
- Test: `web/app/lib/ibkrAuth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/app/lib/ibkrAuth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ibkrBannerVisible, ibkrDotColor } from "./ibkrAuth";

describe("ibkrBannerVisible", () => {
  it("shows when the gateway is unauthenticated or unreachable", () => {
    expect(ibkrBannerVisible("unauthenticated")).toBe(true);
    expect(ibkrBannerVisible("unreachable")).toBe(true);
  });

  it("hides when authenticated or state is unknown (null)", () => {
    expect(ibkrBannerVisible("authenticated")).toBe(false);
    expect(ibkrBannerVisible(null)).toBe(false);
  });
});

describe("ibkrDotColor", () => {
  it("maps each state to a distinct dot color", () => {
    expect(ibkrDotColor("authenticated")).toBe("var(--accent)");
    expect(ibkrDotColor("unauthenticated")).toBe("#d9a441");
    expect(ibkrDotColor("unreachable")).toBe("var(--error)");
    expect(ibkrDotColor(null)).toBe("var(--muted)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/lib/ibkrAuth.test.ts`
Expected: FAIL — cannot resolve `./ibkrAuth`

- [ ] **Step 3: Write the implementation**

Create `web/app/lib/ibkrAuth.ts`:

```ts
import { api } from "./api/client";
import type { Schemas } from "./api/client";

// Live IBKR gateway connection state. Types flow from the generated OpenAPI
// schema — no hand-written duplicates (CLAUDE.md type contract).
export type IbkrAuth = Schemas["IbkrAuthResponse"];
export type IbkrAuthState = IbkrAuth["state"];

// On-demand fetch of the gateway auth state. Throws on a transport/HTTP failure;
// the provider catches it and treats the state as unknown (so we never show a
// false "log in" prompt when the backend itself is down).
export async function loadIbkrAuth(): Promise<IbkrAuth> {
  const { data, error } = await api.GET("/ibkr/auth", {});
  if (error || data === undefined) throw new Error("request failed");
  return data;
}

// Pure: the login banner shows only when the gateway is reachable-but-not-logged-in
// or unreachable. `null` (unknown / backend down) and "authenticated" → hidden.
export function ibkrBannerVisible(state: IbkrAuthState | null): boolean {
  return state === "unauthenticated" || state === "unreachable";
}

// Pure: status-dot color for the Settings connections row.
export function ibkrDotColor(state: IbkrAuthState | null): string {
  switch (state) {
    case "authenticated":
      return "var(--accent)";
    case "unauthenticated":
      return "#d9a441";
    case "unreachable":
      return "var(--error)";
    default:
      return "var(--muted)";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/lib/ibkrAuth.test.ts`
Expected: PASS (2 files? no — 1 file, 2 suites, 4 assertions pass)

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/ibkrAuth.ts web/app/lib/ibkrAuth.test.ts
git commit -m "feat(web): ibkrAuth loader + banner/dot pure helpers"
```

---

## Task 6: `IbkrLoginButton` + `IbkrRecheckButton` shared components

Two small buttons reused by the banner, Settings, and Portfolio. The login button opens the gateway page on a real click so the popup blocker never fires.

**Files:**
- Create: `web/app/components/IbkrLoginButton.tsx`

- [ ] **Step 1: Create the components**

Create `web/app/components/IbkrLoginButton.tsx`:

```tsx
"use client";

import type { CSSProperties } from "react";

// Opens the IBKR gateway's own login page in a new tab on a real user click —
// a programmatic on-load window.open would be blocked by the popup blocker, so
// this is always click-triggered. Renders nothing until the loginUrl is known.
export function IbkrLoginButton({
  loginUrl,
  label = "Open gateway login",
}: {
  loginUrl: string | null;
  label?: string;
}) {
  if (!loginUrl) return null;
  return (
    <button
      onClick={() => window.open(loginUrl, "_blank", "noopener")}
      style={{
        background: "var(--accent)",
        color: "#0b0e14",
        border: "none",
        borderRadius: 6,
        padding: "0.3rem 0.9rem",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "0.82rem",
      }}
    >
      {label}
    </button>
  );
}

const recheckStyle: CSSProperties = {
  background: "transparent",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "0.25rem 0.7rem",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "0.8rem",
};

// "Re-check" the live auth state on demand (used after logging in at the gateway).
export function IbkrRecheckButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} style={recheckStyle}>
      {loading ? "…" : "Re-check"}
    </button>
  );
}
```

- [ ] **Step 2: Verify it type-checks (compiled later in the build step)**

No standalone test (presentational). It is exercised by the build in Task 11.

- [ ] **Step 3: Commit**

```bash
git add web/app/components/IbkrLoginButton.tsx
git commit -m "feat(web): shared IBKR login + re-check buttons"
```

---

## Task 7: `IbkrAuthProvider` context + `useIbkrAuth` hook

One shared source of truth for the auth state: fetches on mount, on window focus (debounced, on-demand — not polling), and on manual `recheck()`.

**Files:**
- Create: `web/app/components/IbkrAuthProvider.tsx`

- [ ] **Step 1: Create the provider**

Create `web/app/components/IbkrAuthProvider.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { loadIbkrAuth, type IbkrAuthState } from "../lib/ibkrAuth";

type IbkrAuthValue = {
  state: IbkrAuthState | null; // null = unknown (initial load, or backend down)
  loginUrl: string | null;
  detail: string | null;
  loading: boolean;
  recheck: () => void;
};

const IbkrAuthContext = createContext<IbkrAuthValue | null>(null);

export function useIbkrAuth(): IbkrAuthValue {
  const ctx = useContext(IbkrAuthContext);
  if (ctx === null) throw new Error("useIbkrAuth must be used within IbkrAuthProvider");
  return ctx;
}

export function IbkrAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<IbkrAuthState | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastRun = useRef(0);

  // First statement is `await` — no synchronous setState, so this is safe to call
  // from an effect (mirrors the useResource pattern).
  const run = useCallback(async () => {
    try {
      const data = await loadIbkrAuth();
      setState(data.state);
      setLoginUrl(data.loginUrl);
      setDetail(data.detail);
    } catch {
      // Backend unreachable → unknown; never show a false "log in" prompt.
      setState(null);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const recheck = useCallback(() => {
    lastRun.current = Date.now();
    setLoading(true);
    void run();
  }, [run]);

  // Fetch the snapshot when the app loads.
  useEffect(() => {
    lastRun.current = Date.now();
    void run();
  }, [run]);

  // Re-check when the user returns to this tab (e.g. after logging in at the
  // gateway). Debounced so rapid refocus doesn't refetch. On-demand, never a
  // background poll (CLAUDE.md hard rule #5).
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastRun.current < 3000) return;
      lastRun.current = Date.now();
      void run();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [run]);

  return (
    <IbkrAuthContext.Provider value={{ state, loginUrl, detail, loading, recheck }}>
      {children}
    </IbkrAuthContext.Provider>
  );
}
```

- [ ] **Step 2: Verify it type-checks (compiled in Task 11)**

No standalone test (React context with browser-only `window`; the repo has no component-test harness, so behavior is verified by the build + manual run).

- [ ] **Step 3: Commit**

```bash
git add web/app/components/IbkrAuthProvider.tsx
git commit -m "feat(web): IbkrAuthProvider context (mount + focus re-check)"
```

---

## Task 8: Global banner + wire into Terminal

The banner shows only when not connected; it carries the login button, a re-check button, and a dismiss control, and re-arms itself once you connect.

**Files:**
- Create: `web/app/components/IbkrAuthBanner.tsx`
- Modify: `web/app/components/Terminal.tsx`

- [ ] **Step 1: Create the banner**

Create `web/app/components/IbkrAuthBanner.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useIbkrAuth } from "./IbkrAuthProvider";
import { IbkrLoginButton, IbkrRecheckButton } from "./IbkrLoginButton";
import { ibkrBannerVisible } from "../lib/ibkrAuth";

// Global "log in to IBKR" banner shown on load when the gateway is not connected.
// One-click opens the gateway login; "Re-check" re-probes; dismiss hides it for
// this session. It re-arms once connected, so a later logout shows it again.
export default function IbkrAuthBanner() {
  const { state, loginUrl, detail, loading, recheck } = useIbkrAuth();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (state === "authenticated") setDismissed(false);
  }, [state]);

  if (!ibkrBannerVisible(state) || dismissed) return null;

  return (
    <div style={bannerStyle}>
      <span style={dot} />
      <span style={{ flex: 1, color: "var(--foreground)" }}>{detail ?? "IBKR is not connected."}</span>
      <IbkrLoginButton loginUrl={loginUrl} />
      <IbkrRecheckButton onClick={recheck} loading={loading} />
      <button onClick={() => setDismissed(true)} style={dismiss} title="Dismiss" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

const bannerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.8rem",
  padding: "0.5rem 1.25rem",
  borderBottom: "1px solid var(--border)",
  background: "rgba(217,164,65,0.08)",
  fontSize: "0.85rem",
};

const dot: CSSProperties = {
  width: 9,
  height: 9,
  borderRadius: 999,
  background: "#d9a441",
  display: "inline-block",
  flex: "0 0 auto",
};

const dismiss: CSSProperties = {
  background: "transparent",
  color: "var(--muted)",
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "0.9rem",
};
```

- [ ] **Step 2: Wire the provider + banner into `Terminal.tsx`**

In `web/app/components/Terminal.tsx`, add imports after the existing component imports (after the `WidgetHost` import line):

```tsx
import { IbkrAuthProvider } from "./IbkrAuthProvider";
import IbkrAuthBanner from "./IbkrAuthBanner";
```

Wrap the returned tree in the provider and render the banner directly under the header. Replace the existing `return (` block's outer `<div>...</div>` so it reads:

```tsx
  return (
    <IbkrAuthProvider>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <header
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: "1rem",
            padding: "0.6rem 1.25rem",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {/* left: the command / search bar */}
          <div style={{ minWidth: 0 }}>
            <CommandBar />
          </div>
          {/* center: brand */}
          <div style={{ textAlign: "center", whiteSpace: "nowrap" }}>
            <strong>Omphalos</strong>
          </div>
          {/* right: live clock + backend health */}
          <div style={{ justifySelf: "end", display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <Clock />
            <HealthChip />
          </div>
        </header>

        <IbkrAuthBanner />

        <TabStrip tabs={tabs} activeId={activeId} />

        <div style={{ flex: 1, overflow: "auto" }}>
          {active ? (
            // key per tab → fresh widget instance + its own data fetch
            <WidgetHost key={active.id} tab={active} />
          ) : (
            <div style={{ padding: "3rem 1.25rem", color: "var(--muted)" }}>
              <p style={{ marginBottom: "0.5rem" }}>No widgets open.</p>
              <p>
                Type a command in the bar above to begin — e.g.{" "}
                <code style={{ color: "var(--accent)" }}>chart AAPL</code>,{" "}
                <code style={{ color: "var(--accent)" }}>chart BTC/USD</code>, or{" "}
                <code style={{ color: "var(--accent)" }}>help</code>.
              </p>
            </div>
          )}
        </div>
      </div>
    </IbkrAuthProvider>
  );
```

- [ ] **Step 3: Commit**

```bash
git add web/app/components/IbkrAuthBanner.tsx web/app/components/Terminal.tsx
git commit -m "feat(web): global IBKR login banner on load"
```

---

## Task 9: Live IBKR row in Settings → Connections

Replace the static IBKR dot/text with the live state, plus the login + re-check buttons. FRED/Kraken rows are unchanged.

**Files:**
- Modify: `web/app/widgets/SettingsWidget.tsx`

- [ ] **Step 1: Add imports**

In `web/app/widgets/SettingsWidget.tsx`, after the existing `import { THEME_LABELS, type ThemeName } from "../lib/themes";` line, add:

```tsx
import { useIbkrAuth } from "../components/IbkrAuthProvider";
import { IbkrLoginButton, IbkrRecheckButton } from "../components/IbkrLoginButton";
import { ibkrDotColor } from "../lib/ibkrAuth";
```

- [ ] **Step 2: Read the hook in the component**

Inside `export default function SettingsWidget() {`, add after the `const { state, refresh } = useResource(statusLoad);` line:

```tsx
  const ibkr = useIbkrAuth();
```

- [ ] **Step 3: Render the live IBKR row**

In the Connections section, replace the existing `state.data.sources.map(...)` block (the one that renders each `<div key={s.source}>`) with this version, which special-cases the `ibkr` row:

```tsx
            {state.data.sources.map((s) => {
              const isIbkr = s.source === "ibkr";
              const dotColor = isIbkr
                ? ibkrDotColor(ibkr.state)
                : s.configured
                  ? "var(--accent)"
                  : "var(--muted)";
              const detail = isIbkr ? ibkr.detail ?? s.detail : s.detail;
              return (
                <div
                  key={s.source}
                  style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}
                >
                  <span
                    title={isIbkr ? ibkr.state ?? "checking" : s.configured ? "configured" : "not configured"}
                    style={{ width: 9, height: 9, borderRadius: 999, background: dotColor, display: "inline-block" }}
                  />
                  <strong style={{ textTransform: "uppercase", fontSize: "0.78rem", width: "4.5rem" }}>
                    {s.source}
                  </strong>
                  <span style={{ color: "var(--muted)", fontSize: "0.82rem", flex: 1, minWidth: "10rem" }}>
                    {detail}
                  </span>
                  {isIbkr && (
                    <>
                      <IbkrLoginButton loginUrl={ibkr.loginUrl} />
                      <IbkrRecheckButton onClick={ibkr.recheck} loading={ibkr.loading} />
                    </>
                  )}
                </div>
              );
            })}
```

- [ ] **Step 4: Commit**

```bash
git add web/app/widgets/SettingsWidget.tsx
git commit -m "feat(web): live IBKR status + login button in Settings"
```

---

## Task 10: Inline login button in the Portfolio widget

When the portfolio reports `unauthenticated` because of IBKR, show the login button right under the status notice.

**Files:**
- Modify: `web/app/widgets/PortfolioWidget.tsx`

- [ ] **Step 1: Add imports + hook**

In `web/app/widgets/PortfolioWidget.tsx`, add after the existing `import { useResource } from "../lib/useResource";` line:

```tsx
import { useIbkrAuth } from "../components/IbkrAuthProvider";
import { IbkrLoginButton } from "../components/IbkrLoginButton";
```

Inside `export default function PortfolioWidget() {`, add after the `const { state, refresh } = useResource(load);` line:

```tsx
  const ibkr = useIbkrAuth();
  // The portfolio merges IBKR positions + Kraken balances; only offer the gateway
  // login when the unauthenticated state actually came from IBKR (its message is
  // prefixed "positions: …" and names the IBKR gateway).
  const ibkrNeedsLogin =
    state.kind === "ok" &&
    state.data.status === "unauthenticated" &&
    Boolean(state.data.message && state.data.message.includes("IBKR"));
```

- [ ] **Step 2: Render the button under the ResourceView**

Still inside the `<WidgetFrame ...>`, add the button block immediately AFTER the closing `</ResourceView>` tag (and before the closing `</WidgetFrame>`):

```tsx
      </ResourceView>
      {ibkrNeedsLogin && (
        <div style={{ marginTop: "0.8rem" }}>
          <IbkrLoginButton loginUrl={ibkr.loginUrl} />
        </div>
      )}
```

(The `<ResourceView ...>{(data) => (...)}</ResourceView>` block itself is unchanged — you are only adding the conditional button after it.)

- [ ] **Step 3: Commit**

```bash
git add web/app/widgets/PortfolioWidget.tsx
git commit -m "feat(web): inline IBKR login button in Portfolio when unauthenticated"
```

---

## Task 11: Full verification

Confirm the whole feature builds and every test passes.

**Files:** none (verification only)

- [ ] **Step 1: Frontend tests**

Run: `cd web && npm test`
Expected: all suites pass (the existing 48 + the new `ibkrAuth` suite)

- [ ] **Step 2: Frontend build (type-checks the new components end-to-end)**

Run: `cd web && npm run build`
Expected: build succeeds with no TypeScript errors

- [ ] **Step 3: Frontend lint**

Run: `cd web && npm run lint`
Expected: no new lint errors

- [ ] **Step 4: Backend suite**

Run: `cd api && python -m pytest -q`
Expected: all tests pass

- [ ] **Step 5: Final commit (if lint/build produced any fixups)**

```bash
git add -A
git commit -m "chore(ibkr): finalize easy-connect feature" || echo "nothing to commit"
```

---

## Self-Review Notes

**Spec coverage:**
- Backend `GET /ibkr/auth` + `IbkrAuthResponse` + `get_auth_state()` + config-derived `loginUrl` → Tasks 1–3. ✓
- Regenerated TS types (no hand-written duplicate) → Task 4. ✓
- Shared `IbkrAuthProvider` (mount + focus + manual re-check, no polling) → Task 7. ✓
- Shared `IbkrLoginButton` (real-click open, no popup block) → Task 6. ✓
- Surface 1 global banner → Task 8; Surface 2 Settings → Task 9; Surface 3 Portfolio inline → Task 10. ✓
- Error/empty states (unreachable, backend-down → unknown/hidden) → handled in Tasks 3 (`_IBKR_DETAIL`/unreachable) and 7 (catch → null). ✓
- Tests: backend helper/method/endpoint (Task 3), frontend pure helpers (Task 5), build/lint (Task 11). ✓

**Type consistency:** `IbkrAuthState` (backend `Literal` ↔ frontend `Schemas["IbkrAuthResponse"]["state"]`), `get_auth_state()`, `gateway_login_url()`, `loadIbkrAuth()`, `ibkrBannerVisible()`, `ibkrDotColor()`, `useIbkrAuth()`, `IbkrLoginButton`, `IbkrRecheckButton` — names match across all tasks. The wire field is `loginUrl` (camelCase) on the frontend, `login_url` (snake_case) in Python, per the `CamelModel` alias generator. ✓

**No component-render tests:** the repo has no React testing-library harness (all `web` tests are pure-function/store unit tests), so React behavior is covered by `npm run build` (types) + manual run, consistent with the existing codebase. Pure logic (`ibkrBannerVisible`, `ibkrDotColor`) IS unit-tested.
