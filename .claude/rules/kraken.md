# Kraken — spot, read-only

## Public (no auth)
- Use the Ticker and OHLC REST endpoints for prices/candles.
- Normalize epoch-seconds → epoch-milliseconds at the adapter boundary; emit
  canonical Candle/Quote shapes.

## Private (balances)
- API key + private key. Sign with HMAC-SHA512 over an increasing nonce.
- Implement the `API-Sign` construction EXACTLY per Kraken's official auth docs
  (HMAC over URI path concatenated with SHA-256(nonce + POST data); private key is
  base64-decoded for the HMAC key; output is base64-encoded). Verify against the
  docs — do not guess the byte order or concatenation.
- Nonce must be strictly increasing per key; use a monotonic source (ms timestamp)
  and guard against concurrent collisions.
- Respect the rate-limit counter; back off rather than hammering.
- Key/secret come from `api/.env` only.
- Normalize results to the canonical Balance shape.
