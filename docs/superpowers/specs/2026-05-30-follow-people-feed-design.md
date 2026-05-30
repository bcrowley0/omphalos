# Follow People — design

**Date:** 2026-05-30
**Status:** approved (design); pending implementation plan

## Summary

A new widget that lets the user **follow people** (investors, builders, etc. —
e.g. Paul Tudor Jones, Stanley Druckenmiller, Andrej Karpathy, Boris Cherny) and
see their public appearances and the public posts/articles featuring them:
news, articles, interviews, podcasts, talks, and first-party blog/video content.

The user chooses who to follow and can attach optional first-party feeds per
person. Content is aggregated **on demand** (on widget open and on an explicit
"scan now"), with a short-TTL cache, and a "new since you last looked" badge that
gives a daily-catch-up feel without any background job.

## Decisions (locked)

| Question | Decision |
| --- | --- |
| "Daily scrape" timing | **On-demand + cached.** No background job. "New since last view" tracked client-side. Honors CLAUDE.md rule #5. |
| Persistence | **localStorage + in-memory cache.** Follow-list (and per-person seen-state) persist in the browser like the watchlist; results held in the backend TTL cache. No database. |
| Sources (v1) | **News search per person + optional per-person custom feeds** (blog RSS, YouTube channel, podcast). |
| View shape | **Roster + aggregated feed + per-person tabs.** |

## CLAUDE.md conflicts surfaced & resolved

- **Rule #5 (snapshot/on-demand only, no streaming/background jobs):** the original
  "daily scrape" idea would violate this. Resolved by doing on-demand + cached
  fetching; the daily feel comes from a client-side `lastSeenTs` "new" badge, not a
  scheduler. The backend bulk endpoint is *shaped* so a scheduler could call it
  later, but no scheduler is added in v1.
- **"No database":** true day-over-day diffing that survives a backend restart would
  need a store. Resolved by keeping the follow-list and per-person `lastSeenTs` in
  `localStorage` and results in the existing in-memory TTL cache. No DB.

## Explicitly out of scope (v1)

- Pulling a person's **own X/Twitter posts** — no free, ToS-compliant source (X API
  is paid; scrapers are unreliable). v1 covers content *about/featuring* the person
  plus any first-party RSS/YouTube/podcast feeds the user attaches.
- A real **scheduled daily cron**. (Bulk endpoint is scheduler-ready for later.)
- Scraping full article bodies — forbidden by CLAUDE.md; headlines link out only.

## Command grammar additions

Mirrors `watch` / `unwatch` / watchlist. Names may contain spaces (parsed as the
rest of the line, like `news [feed]`).

- `follow <name>` — add the person (if absent) and open/focus their feed tab.
- `unfollow <name>` — remove the person from the follow-list.
- `following` — open the roster + aggregated feed widget.
- `help` lists the new commands.

Parser, symbol-router behavior (these commands are not symbol-routed), and the
command→tab mapper are updated; all covered by the existing Vitest suites.

## Data model (canonical, new)

Pydantic in `api/` remains the single source of truth; TS regenerated from OpenAPI.

```
FollowItem:
  person: str          # which followed person this item is about
  title: str
  summary: str         # one-line teaser (HTML stripped)
  url: str             # links OUT; no body fetched
  publishedTs: int|null  # UTC epoch ms
  source: str          # human label, e.g. "Google News", "YouTube", domain
  kind: "news" | "video" | "blog" | "podcast"
```

Request/response envelopes:

```
PersonRef:        { name: str, feeds: list[str] }      # feeds = custom feed URLs
PeopleFeedRequest:  { people: list[PersonRef], limitPerPerson?: int }
PeopleFeedResponse: { status: SourceStatus, message?: str,
                      items: list[FollowItem],
                      errors: list[{ person: str, message: str }] }
```

`kind` derivation: a `youtube.com` feed → `video`; the Google-News search feed →
`news`; otherwise `blog` (podcast feeds may also be attached and surface as `blog`
in v1 unless the URL clearly indicates a podcast).

## Backend

New **`PeopleAdapter`** (source name `"people"`), reusing the shared httpx layer,
TTL cache, and RSS `parse_feed`:

- `google_news_search_url(name) -> str` (pure): builds
  `https://news.google.com/rss/search?q="<name>"&hl=en-US&gl=US&ceid=US:en`
  (quoted exact-name query; URL-encoded).
- `get_person_feed(name, feeds) -> list[FollowItem]`: fetch the Google-News search
  feed + each custom feed in parallel; parse via `parse_feed`; tag each item with
  `person` and a derived `kind`/`source`; dedupe by URL; sort by `publishedTs`
  desc (undated items last); cache per `(name, sorted(feeds))` ~15–30 min.
- A single failing feed for a person degrades to skipping that feed, not failing
  the person; a failing person is reported in `errors[]`, others still return.

Endpoint:

- `POST /people/feed` (body `PeopleFeedRequest`) → `PeopleFeedResponse`.
  - Per-person tab calls it with one person; aggregated view with all — one code
    path. Per-person results come from the cache, so the aggregated call reuses
    work. `status` = `ok` if any items, `empty` if none and no errors, else
    `source_down` when all people errored. Partial failures listed in `errors[]`.

Registered in `deps.py`. Unit tests (pytest): search-URL builder, `kind`
derivation, and merge/dedupe/sort of `FollowItem`s from sample parsed entries.

## Frontend

**Store (`terminalStore`):** add a persisted `following: Person[]` where
`Person = { name: string, feeds: string[], lastSeenTs: number }`, persisted in
`localStorage` alongside `tabs` / `activeId` / `watchlist`.

- Seeded on first run (when `following` is empty and nothing persisted) with:
  Paul Tudor Jones, Stanley Druckenmiller, Andrej Karpathy, Boris Cherny
  (name only; no custom feeds).
- Actions: `followPerson(name)`, `unfollowPerson(name)`, `addPersonFeed(name, url)`,
  `markSeen(name | "*")` (sets `lastSeenTs = now`). `dispatch` wires
  `follow`/`unfollow`/`following` to these + tab open/focus.
- Store unit tests extended (jsdom): follow/unfollow dedupe, seed-on-first-run,
  persistence round-trip across a fresh store (a "refresh"), markSeen.

**Loaders:** `loadPeopleFeed(people: Person[])` → `POST /people/feed`. Types come
from the regenerated schema; no hand-written interfaces.

**Widgets:**

- **`FollowingWidget`** (the `following` command, tab id `following`):
  - Roster: list followed people with remove (✕); an "add person" input; per-person
    "attach feed URL" affordance.
  - Aggregated feed: newest-first `FollowItem`s across all followed people, each a
    headline linking out + teaser + `person` + `kind`/`source` + time-ago.
  - Per-person filter chips; **"scan now"** refresh; **"● new"** badge on items with
    `publishedTs > lastSeenTs` for that person.
  - Seen semantics: the badge is computed against the `lastSeenTs` **captured when
    the widget mounted**, so new items stay visibly badged for the whole session;
    `markSeen("*")` is then called (after the feed loads) so the *next* open
    reflects that you've seen them. This avoids badges vanishing on render.
  - Clicking a person opens their tab via `follow <name>`.
- **`PersonFeedWidget`** (per-person tab, id `person:<name>`): one person's items +
  a small form to attach a custom feed URL (calls `addPersonFeed`, refetches).

Both reuse the shared `WidgetFrame` / `ResourceView` / loading-error-empty UI and
`useResource` (on-demand + refresh). `WidgetHost`, `commandToTab`, and the help
list are extended.

## Error & empty states (rule #6)

- Backend unreachable → `useResource` transport_error ("cannot reach backend").
- `POST /people/feed` non-ok status → shared `StatusNotice`
  (`source_down` / `empty`). Partial `errors[]` rendered as a small inline note
  ("couldn't reach feed for X") above the items that did load.
- Following list empty → roster shows a hint: "follow &lt;name&gt; to start".
- Person with zero items → "No recent items for &lt;name&gt;."

## Testing

- **pytest:** `google_news_search_url`, `kind` derivation, FollowItem
  merge/dedupe/sort. Optional: a `httpx.MockTransport` test of `get_person_feed`
  merging Google-News + a custom feed.
- **Vitest:** parser (`follow`/`unfollow`/`following`, multi-word names),
  command→tab mapping, and store (seed, follow/unfollow, markSeen, persistence).
- Frontend lint + `tsc` + production build; backend import + full pytest.
- Live smoke: real Google-News items for a seeded person through the proxy; an
  unreachable custom feed degrades gracefully.

## Files touched (anticipated)

- `api/app/models.py` — `FollowItem`, `PersonRef`, `PeopleFeedRequest/Response`.
- `api/app/adapters/people.py` — new `PeopleAdapter`.
- `api/app/deps.py`, `api/app/routers.py` — register + endpoint.
- `api/tests/test_people.py` — unit tests.
- `web/app/lib/command/{types,parser,tabs}.ts` (+ tests) — new verbs.
- `web/app/lib/store.ts` (+ test) — `following` state & actions.
- `web/app/lib/loaders.ts`, `web/app/lib/api/{client,schema}.ts` — loader + regen.
- `web/app/widgets/FollowingWidget.tsx`, `web/app/widgets/PersonFeedWidget.tsx`.
- `web/app/components/WidgetHost.tsx`, `web/app/widgets/HelpWidget.tsx`.
- `README.md` — document the feature.
