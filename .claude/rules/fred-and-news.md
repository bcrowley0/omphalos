# FRED + News

## FRED (yield curve, macro)
- Simple `api_key` query param (from `api/.env`).
- Yield curve = latest observation of each daily Treasury constant-maturity series,
  plotted rate vs tenor. Candidate series IDs (verify each exists before relying on
  it): `DGS1MO, DGS3MO, DGS6MO, DGS1, DGS2, DGS3, DGS5, DGS7, DGS10, DGS20, DGS30`.
- Normalize FRED date strings → epoch-ms; emit canonical YieldPoint.
- Optional: an economic-release calendar via FRED releases. Otherwise stub `cal`
  with a clear "not implemented" state.

## News (generic RSS — headlines only)
- ONE generic adapter that accepts ANY feed URL and parses
  title / summary / link / publishedTs SERVER-SIDE (e.g. `feedparser`) to avoid CORS.
- Preconfigure FT (`https://www.ft.com/rss/home`) and a WSJ feed; allow
  runtime-added feed URLs.
- Feeds carry headline + one-line teaser only. Render a list linking OUT to the
  browser. NEVER fetch or scrape full article bodies (paywalled; violates ToS).
- Cache feed fetches (short TTL) to avoid refetching on every render.
- Normalize to the canonical NewsItem shape.
