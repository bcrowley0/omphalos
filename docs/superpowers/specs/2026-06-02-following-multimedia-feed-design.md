# Following — Multimedia Feed — design

**Date:** 2026-06-02
**Status:** approved (design); pending implementation plan
**Builds on:** `2026-05-30-follow-people-feed-design.md`

## Summary

Enrich the existing **following** feature (`follow <NAME>` / `following`) so a
followed person's feed auto-aggregates their **multimedia output** — YouTube
videos, podcasts, public speeches/talks, and long-form writing — instead of being
news-headline-centric.

Today each followed person yields a Google News search on their name plus any
manually-pasted feed URLs, and items are classified only as `news`/`video`/`blog`.
This change adds **podcasts** and **YouTube channel uploads** as first-class
auto-discovered sources, adds a **speech** classification spanning video *and*
audio, and gives each followed person a **per-person source profile**
(per-content-type on/off toggles + optional anchors that lock the exact
channel/feed when auto-discovery guesses wrong).

All sources remain keyless, backend-proxied, on-demand + cached, read-only, and
degrade independently. No new secrets, no websockets, no article-body scraping.

## Decisions (locked)

| Question | Decision |
| --- | --- |
| Target feature | The **following** feature (`follow`/`following`), not the generic news widget. |
| Content types | **YouTube videos, podcasts, public speeches, long-form writing** (plus existing news). |
| Discovery model | **Hybrid** — auto-discover podcasts *and* YouTube, each with an optional **anchor** override. |
| Podcast discovery | **Auto** via iTunes Search API (keyless), name-gated; anchor = explicit podcast feed URL. |
| YouTube discovery | **Auto** best-effort: resolve name → `channelId` from YouTube's public channel-search page (hard name-gate); anchor = explicit `@handle`/channel URL/`channelId`. |
| Writing discovery | **Anchored RSS only** — no reliable keyless auto from a bare name. |
| Speech | A **derived classification**, not a separate source: talk-like **video OR audio (podcast)** items become `kind="speech"`. Gated per person. |
| Per-person customization | **Toggles + anchors.** Each followed person has on/off toggles for each content type and optional anchors per type. |
| Attach UX | **Widget UI** — a per-person settings popover on the roster chip (no command-grammar change). |

## CLAUDE.md conflicts surfaced & resolved

- **Rule: "No scraping paywalled article bodies."** YouTube channel/search pages are
  fetched **once** server-side only to extract a `channelId` (and to read RSS feeds);
  we never fetch or store article/video bodies. Headlines/titles link out to the
  browser. This is the same one-shot public-page ID-extraction technique, not body
  scraping. Compliant.
- **Rule: "Don't hand-write TS types that duplicate Pydantic models."** The
  per-person profile shape that crosses the wire (`PersonRef`) is defined in
  Pydantic and the TS client is regenerated from OpenAPI. The **client-side-only**
  `Person` localStorage shape (with `lastSeenTs`) is a superset owned by the
  frontend store and is allowed (it is UI state, not a response shape) — mirroring
  how the watchlist/following list already lives in `localStorage`.
- **Rule: keyless / secrets only in `api/.env`.** iTunes Search and YouTube
  channel/RSS endpoints need no key. Nothing new added to `.env`.
- **Rule #5 (on-demand + cached, no background jobs/streaming).** Unchanged: fetch
  on widget open and on explicit refresh; the existing TTL cache covers all new
  sources. Auto-refresh opt-in is *not* added here (following is not in the
  live-data widget set).

## Honest limitations (flagged)

- **Keyless YouTube auto-discovery is fragile.** There is no official keyless
  YouTube search→RSS. Auto-discovery scrapes the top channel match off the public
  channel-search page and accepts it **only if the channel title matches the
  person's name**. A wrong or missing guess yields *no* videos rather than wrong-
  person noise; the **anchor** is the reliable fix. This fragility is by design,
  not a defect.
- **Podcast auto-discovery finds shows the person hosts / shows named after them**,
  not arbitrary guest appearances. Guest spots still surface via Google News / video
  classification. Anchor a specific feed to lock a show.

## Explicitly out of scope

- X/Twitter posts (no free ToS-compliant source — already out of scope upstream).
- A dedicated "speeches" source/index — speeches are a classification over
  video/audio, not a crawl target.
- Auto-discovery of long-form writing from a name (anchored RSS only).
- Background scheduling / auto-refresh for the following widget.

## Canonical data model changes

### `FollowItem.kind`

Widen the documented domain to:

```
kind: "news" | "video" | "podcast" | "blog" | "speech"
```

(`podcast` was already anticipated in the model comment; `speech` is new.) No new
required fields on `FollowItem`. `publisher`/`primary`/`relevant` semantics are
unchanged; first-party sources (anchored feeds, the person's own channel/podcast)
are `primary=True`.

### Per-person profile

Client-side `Person` (localStorage, owned by the frontend store):

```ts
type ContentType = "news" | "videos" | "podcasts" | "speeches" | "writing";

type Person = {
  name: string;
  lastSeenTs: number;
  enabled: Record<ContentType, boolean>; // news/videos/podcasts/speeches default true; writing true iff anchored
  anchors: {
    youtube?: string;    // @handle | channel URL | channelId — locks the channel
    podcast?: string;    // podcast feed URL — locks the show
    writing?: string[];  // blog/Substack/Medium RSS URLs — writing's only source
  };
};
```

Wire shape `PersonRef` (Pydantic, source of truth — regenerate TS client):

```python
class PersonAnchors(CamelModel):
    youtube: str | None = None
    podcast: str | None = None
    writing: list[str] = []

class PersonRef(CamelModel):
    name: str
    enabled: dict[str, bool] = {}      # missing key => default-on (except writing)
    anchors: PersonAnchors = PersonAnchors()
```

### Migration

On store load, any legacy `Person.feeds: string[]` is sorted into `anchors`
(`classify_feed_url`: YouTube handle/URL → `youtube`; itunes/podcast feed →
`podcast`; otherwise → `writing[]`) and `enabled` defaults are applied
(`news/videos/podcasts/speeches` = true; `writing` = true iff `writing` anchors
exist). Backward-compatible; no data loss; the old `feeds` key is dropped after
migration.

## Backend (`api/app/adapters/people.py`)

New **pure / unit-testable** helpers (no I/O):

- `classify_speech(title: str) -> bool` — talk keywords (keynote, talk, lecture,
  fireside, interview, testimony, address, "speaks at", conference, summit, panel,
  commencement, …). Used to upgrade `video`/`podcast` items to `kind="speech"`.
- `classify_feed_url(url: str) -> "youtube" | "podcast" | "writing"` — route an
  attached/anchored URL (used by migration and anchor handling).
- `parse_itunes_podcasts(json, name) -> list[str]` — extract `feedUrl`s from an
  iTunes Search response, **name-gated** on `artistName`/`collectionName`.
- `extract_channel_id(html) -> str | None` — pull `"channelId":"UC…"` /
  canonical-link from a YouTube channel or search-results page.
- `channel_rss_url(channel_id) -> str` — build `feeds/videos.xml?channel_id=…`.
- `youtube_search_url(name)`, `itunes_search_url(name)` — pure URL builders
  (mirrors existing `google_news_search_url`).

I/O methods (fault-isolated, cached):

- `resolve_youtube_anchor(anchor) -> channel_rss_url` — `@handle`/URL → fetch page
  → `extract_channel_id` → RSS; direct `channelId`/`/channel/UC…` skip the fetch.
  Cached **long-TTL** (handle→id rarely changes).
- `discover_youtube_channel(name) -> channel_rss_url | None` — fetch channel-search
  page → `extract_channel_id`, accept **only** if the channel title matches `name`.
  Cached long-TTL.
- `get_person_feed(person_ref)` rewritten to fetch, **in parallel**, only the
  sources whose toggle is on:
  - `news` → Google News search (existing).
  - `podcasts` → `anchors.podcast` if set, else iTunes search (name-gated) → RSS.
  - `videos` → `anchors.youtube` resolved if set, else `discover_youtube_channel`.
  - `writing` → each `anchors.writing` RSS.
  Then, if `speeches` on, apply `classify_speech` over video+podcast items
  (`kind="speech"`). Existing `dedupe_stories` / `merge_dedupe_sort` /
  primary-vs-secondary path is unchanged.
- **Fault isolation preserved:** each source is wrapped so one failure (iTunes down,
  unresolvable handle, bad RSS) drops that source and keeps the rest — existing
  per-source `try/except` pattern. A person with zero successful sources surfaces
  via the existing `FeedError` ("couldn't reach").

Router `/people/feed` accepts the new `PersonRef` shape; per-person `enabled`/
`anchors` flow through. Caching reuses the existing TTL cache + the long-TTL
resolution cache.

## Frontend

- **`store.ts`** — `Person` shape extended (`enabled`, `anchors`); migration on
  load; new mutators: `setPersonEnabled(name, type, on)`, `setPersonAnchor(name,
  type, value)`, `addWritingFeed`/`removeWritingFeed`. `loadPeopleFeed` sends the
  new `PersonRef` shape.
- **`FollowingWidget.tsx`** — roster chip gains a **settings popover** (reuse
  `WidgetSettingsMenu`/`ToggleRow` style): five content-type toggles + anchor
  inputs (YouTube handle/URL, podcast feed, writing RSS list with add/remove).
  Light client-side validation/normalization of pasted values.
- **`FeedItemList.tsx`** — per-`kind` icon/label and a **kind-filter chip row**
  alongside the existing person filter and curated toggle. UI label mapping:
  `news`→News, `video`→Video, `podcast`→Podcast, `speech`→Speech, **`blog`→Writing**
  (the canonical `kind` stays `blog`; only the display label is "Writing").

## Error / UI states

Every external call keeps an explicit state (loading, source-down, empty). Per-
source failure is silent-but-isolated; per-person reachability shows via
`FeedError`. Auto-discovery miss (no name-matched channel/podcast) = that type
simply contributes nothing, with the anchor offered as the fix. No unhandled crash.

## Testing (TDD)

- **Backend pure fns** (unit): `classify_speech`, `classify_feed_url`,
  `parse_itunes_podcasts` (incl. name-gate rejecting wrong shows),
  `extract_channel_id` (against fixture HTML for handle page + search page),
  URL builders, migration sorting.
- **Adapter** (`get_person_feed`, anchor/auto resolution): injected `httpx`
  MockTransport (existing pattern) covering each source on/off, anchor-vs-auto,
  one-source-down isolation, zero-source `FeedError`.
- **Frontend** (vitest): store migration of legacy `feeds`; toggle/anchor mutators;
  settings popover behavior; kind-filter + per-kind rendering in `FeedItemList`.

## Open questions

None blocking. (Title-keyword list for `classify_speech` will be tuned during
implementation against real feeds.)
