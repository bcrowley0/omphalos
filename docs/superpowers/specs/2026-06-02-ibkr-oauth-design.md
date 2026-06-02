# IBKR OAuth 1.0a — Headless Sign-In (Design)

**Date:** 2026-06-02
**Status:** Approved (design); implementation plan to follow
**Branch:** `feat/ibkr-oauth`

## Problem

Omphalos's IBKR integration authenticates through the **Client Portal Gateway**: a
local Java process the user starts manually, then logs into via the browser
(clicking through a self-signed-cert warning) every session. The session must be
kept alive with `/tickle` and re-established on drop. This is high-friction for
daily use and — per the README's own caveat — **cannot be authenticated headlessly**,
which blocks any future server deployment.

A related UX bug (the app offered an "Open gateway login" link even when the
gateway was unreachable, yielding a dead "can't connect to localhost:5000" tab) is
fixed separately in **PR #6** and is out of scope here.

## Goal

Add a **fully headless** IBKR auth path using IBKR's **Web API OAuth 1.0a**
(self-service, individual account): no gateway process, no browser login, no
daily 2FA tap, and server-deployable. Requests route directly to
`https://api.ibkr.com/v1/api`.

Keep the existing gateway path working as a **config-selected fallback** so the
migration carries minimal risk.

## Non-goals (YAGNI)

- No order entry — `place_order` stays stubbed (`NotImplementedError`).
- No OAuth 2.0 (institutional/third-party multi-client).
- No UI entry of OAuth secrets — env-only; RSA key files don't belong in a text box.
- IBeam (auto-login container) is **not** pursued: it can't automate the user's
  IBKR Mobile **push** 2FA, so it still requires a ~daily phone tap. OAuth removes
  the tap entirely.

## Approach

### Pluggable auth transport

Introduce a small **auth-transport** abstraction *inside* `IbkrAdapter`. The
adapter's data methods (`get_quote`, `get_positions`, `get_candles`) and the
existing pure parsers (`parse_snapshot`, `parse_history`, `parse_position`) are
**unchanged** — they call `self._get` / `self._post` / `self._ensure_session`,
which delegate to the selected transport.

```
IbkrAdapter
  ├─ transport: GatewayTransport | OAuthTransport      (chosen by config)
  │     • base_url           localhost:5000  |  api.ibkr.com
  │     • build_client()     verify=False    |  verify=True + request signing
  │     • ensure_session()   /tickle         |  live session token + /iserver/auth/ssodh/init
  └─ get_quote / get_candles / get_positions → parse_*  (UNCHANGED)
```

- **GatewayTransport** — today's behavior, extracted verbatim (localhost base URL,
  TLS verify off for the localhost client only, `/tickle` keepalive).
- **OAuthTransport** — uses the **ibind** library *for the auth handshake only*:
  obtain the 24-hour live session token (LST) via the Diffie-Hellman exchange and
  sign each outgoing request; target `https://api.ibkr.com/v1/api` with normal TLS
  verification; initialize the brokerage session via `/iserver/auth/ssodh/init`
  and keep it alive with `/tickle`.

**ibind scope:** auth only. ibind is maintained (v0.1.23, Apr 2026) but
self-described **beta** and not endorsed by IBKR, so its blast radius is confined
to the auth/transport layer. The proven data path and canonical normalization do
not depend on it.

### Mode selection

New setting `IBKR_AUTH_MODE` with values `oauth | gateway`. Default resolution:
**`oauth` if OAuth credentials are present, else `gateway`.** This means nothing
breaks before the user completes the portal setup.

### Configuration & secrets

All secrets live only in `api/.env` (hard rule #2). New settings:

| Setting | Purpose |
|---|---|
| `IBKR_AUTH_MODE` | `oauth` \| `gateway` (optional; auto-resolves) |
| `IBKR_OAUTH_CONSUMER_KEY` | OAuth consumer key from the self-service portal |
| `IBKR_OAUTH_ACCESS_TOKEN` | Access token from the portal |
| `IBKR_OAUTH_ACCESS_TOKEN_SECRET` | Access token secret from the portal |
| `IBKR_OAUTH_SIGNATURE_KEY_PATH` | Path to the RSA private **signature** key |
| `IBKR_OAUTH_ENCRYPTION_KEY_PATH` | Path to the RSA private **encryption** key |
| `IBKR_OAUTH_DH_PRIME` | Diffie-Hellman prime (hex) |

RSA private key files live in a **gitignored** `api/secrets/` directory.
`.env.example` gains commented placeholders plus a pointer to the portal setup
steps (generate keys, register public keys, mint access token).

### Auth states & frontend impact

Reuse the existing three states (`authenticated | unauthenticated | unreachable`),
remapped for OAuth:

- `authenticated` — LST obtained **and** brokerage session initialized.
- `unauthenticated` — OAuth credentials rejected/expired (bad signature, revoked
  token). Detail text guides "check IBKR OAuth credentials in `api/.env`."
- `unreachable` — `api.ibkr.com` down or rate-limited (reuses the existing
  `http.py` 401/403/429 → clean-state mapping).

**One small frontend change:** make `IbkrAuthResponse.login_url` optional
(`null` in OAuth mode). `IbkrLoginButton` already renders nothing when `loginUrl`
is null, so in OAuth mode no login button appears — the `detail` text guides the
user instead. The type contract regenerates `login_url: string | null`, which the
existing component prop already accepts. (Composes cleanly with PR #6.)

### Error handling (rule #6 — never crash)

OAuth requests flow through the same `http.py` `get_json` / `post_form` helpers,
so loading / source-down / unauthenticated / rate-limited / empty are already
covered. LST-handshake failures map to `unauthenticated`; transport failures to
`unreachable`. `get_auth_state` continues to never raise.

## Testing

- **Unit (no secrets):** mode-selection resolution, transport construction/config,
  state mapping, and the existing `parse_*` tests. ibind's auth is mocked.
- **Live (manual):** end-to-end against `api.ibkr.com` requires the user's real
  credentials — a documented manual verification step, not CI.

## Open risk (resolved during planning, not implementation)

Whether ibind cleanly exposes "produce a live session token + sign this request"
**without** adopting its full `IbkrClient`. To be confirmed against ibind's source
during plan-writing. If awkward, the fallback is to vendor/adapt ibind's OAuth
module (it is "based on code provided directly by IBKR"). Either outcome leaves
the data path and parsers untouched.

## User-side prerequisites (one-time, in the IBKR portal)

1. Register an OAuth consumer → obtain the consumer key.
2. Generate two RSA key pairs (signature + encryption); upload the public keys.
3. Generate the access token + access token secret.
4. Obtain the Diffie-Hellman prime.

## References

- IBKR Campus — OAuth 1.0a Extended: https://www.interactivebrokers.com/campus/ibkr-api-page/oauth-1-0a-extended/
- ibind OAuth 1.0a wiki: https://github.com/Voyz/ibind/wiki/OAuth-1.0a
- IBeam 2FA (why it's rejected): https://github.com/Voyz/ibeam/wiki/Two-Factor-Authentication
