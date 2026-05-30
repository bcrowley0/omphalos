# Follow People Feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "follow people" feature: the user follows public figures and sees aggregated public items about/by them (news, interviews, podcasts/talks, first-party blog/video), on-demand and cached.

**Architecture:** A new stateless backend `PeopleAdapter` (source `"people"`) reuses the existing RSS infra to fetch a Google-News search feed per person plus optional per-person custom feeds, normalizing to a canonical `FollowItem`. A `POST /people/feed` endpoint fans out over a list of people. The follow-list lives client-side in `localStorage` (like the watchlist); a `FollowingWidget` (roster + aggregated feed) and a `PersonFeedWidget` (per-person tab) render it. No background job, no database — the "daily" feel comes from a client-side `lastSeenTs` "new" badge.

**Tech Stack:** FastAPI + Pydantic + httpx + feedparser (backend); Next.js + TypeScript + Vitest (frontend). Reuses `app/http.py`, `app/cache.py`, `app/adapters/rss.py:parse_feed`, and the frontend `useResource`/`ResourceView`/`WidgetFrame`/terminal store.

**Spec:** `docs/superpowers/specs/2026-05-30-follow-people-feed-design.md`

---

## File Structure

- `api/app/models.py` — add `FollowItem`, `PersonRef`, `PeopleFeedRequest`, `PeopleFeedResponse`, `FeedError`.
- `api/app/adapters/people.py` — **new** `PeopleAdapter` + pure helpers (`google_news_search_url`, `derive_kind`, `merge_dedupe_sort`, `to_follow_items`).
- `api/app/deps.py` — register `PeopleAdapter`.
- `api/app/routers.py` — add `POST /people/feed`.
- `api/tests/test_people.py` — **new** unit tests (pure helpers + a `MockTransport` feed test).
- `web/app/lib/command/types.ts` — add `Person`, `follow`/`unfollow`/`following` to `Command`, `WidgetKind`, `Tab.person`.
- `web/app/lib/command/parser.ts` — parse the new verbs.
- `web/app/lib/command/tabs.ts` — map new commands to tabs.
- `web/app/lib/command/{parser,tabs}.test.ts` — tests for the above.
- `web/app/lib/store.ts` — `following` state, seed, persistence, actions.
- `web/app/lib/store.test.ts` — follow/unfollow/seed/persist tests.
- `web/app/lib/loaders.ts` — `loadPeopleFeed`.
- `web/app/lib/api/client.ts` — export `FollowItem`, `Person` types; `schema.ts` regenerated.
- `web/app/widgets/FollowingWidget.tsx` — **new** roster + aggregated feed.
- `web/app/widgets/PersonFeedWidget.tsx` — **new** per-person tab.
- `web/app/components/WidgetHost.tsx` — route `following`/`person` widgets.
- `web/app/widgets/HelpWidget.tsx` — list new commands.
- `README.md` — document the feature.

---

## Task 1: Backend canonical models

**Files:**
- Modify: `api/app/models.py` (append after `AddFeedRequest`)
- Test: `api/tests/test_people_models.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# api/tests/test_people_models.py
from app.models import FollowItem, PeopleFeedResponse, SourceStatus


def test_follow_item_serializes_camelcase():
    item = FollowItem(
        person="Andrej Karpathy", title="Talk", summary="t", url="https://x/y",
        published_ts=123, source="YouTube", kind="video",
    )
    d = item.model_dump(by_alias=True)
    assert d["publishedTs"] == 123
    assert d["kind"] == "video"
    assert d["person"] == "Andrej Karpathy"


def test_people_feed_response_defaults():
    r = PeopleFeedResponse(status=SourceStatus.OK)
    assert r.items == [] and r.errors == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && ./.venv/bin/pytest tests/test_people_models.py -q`
Expected: FAIL — `ImportError: cannot import name 'FollowItem'`

- [ ] **Step 3: Add the models**

Append to `api/app/models.py`:

```python
class FollowItem(CamelModel):
    person: str
    title: str
    summary: str
    url: str
    published_ts: int | None = None  # UTC epoch ms
    source: str  # human label, e.g. "Google News", "YouTube", domain
    kind: str  # "news" | "video" | "blog" | "podcast"


class PersonRef(CamelModel):
    name: str
    feeds: list[str] = []  # optional custom feed URLs (blog / YouTube / podcast)


class PeopleFeedRequest(CamelModel):
    people: list[PersonRef] = []
    limit_per_person: int = 25


class FeedError(CamelModel):
    person: str
    message: str


class PeopleFeedResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    items: list[FollowItem] = []
    errors: list[FeedError] = []
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && ./.venv/bin/pytest tests/test_people_models.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add api/app/models.py api/tests/test_people_models.py
git commit -m "feat(people): canonical FollowItem + people-feed request/response models"
```

---

## Task 2: PeopleAdapter pure helpers (TDD)

**Files:**
- Create: `api/app/adapters/people.py`
- Test: `api/tests/test_people.py`

- [ ] **Step 1: Write the failing test**

```python
# api/tests/test_people.py
from app.adapters.people import (
    derive_kind,
    google_news_search_url,
    merge_dedupe_sort,
    to_follow_items,
)
from app.models import NewsItem


def test_google_news_search_url_quotes_and_encodes_name():
    url = google_news_search_url("Paul Tudor Jones")
    assert url.startswith("https://news.google.com/rss/search?q=")
    assert "%22Paul%20Tudor%20Jones%22" in url  # quoted, space-encoded
    assert "ceid=US:en" in url


def test_derive_kind():
    assert derive_kind("https://www.youtube.com/watch?v=abc") == "video"
    assert derive_kind("https://news.google.com/rss/articles/xyz") == "news"
    assert derive_kind("https://karpathy.github.io/2024/post") == "blog"


def test_to_follow_items_tags_person_kind_source():
    news = [NewsItem(title="T", summary="s", url="https://www.youtube.com/watch?v=1",
                     published_ts=10, feed="YouTube")]
    items = to_follow_items(news, person="Andrej Karpathy", source_label="YouTube")
    assert len(items) == 1
    it = items[0]
    assert it.person == "Andrej Karpathy"
    assert it.kind == "video"
    assert it.source == "YouTube"


def test_merge_dedupe_sort_dedupes_by_url_and_sorts_desc():
    from app.models import FollowItem
    mk = lambda url, ts: FollowItem(person="P", title="t", summary="", url=url,
                                    published_ts=ts, source="s", kind="news")
    merged = merge_dedupe_sort([mk("a", 100), mk("b", 300), mk("a", 100), mk("c", None)])
    urls = [i.url for i in merged]
    assert urls[0] == "b"          # newest first
    assert urls.count("a") == 1    # deduped
    assert urls[-1] == "c"         # undated sinks to the end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && ./.venv/bin/pytest tests/test_people.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.adapters.people'`

- [ ] **Step 3: Write the pure helpers**

```python
# api/app/adapters/people.py
"""People — follow public figures and aggregate public items about/by them.

Stateless: the follow-list lives client-side; each request names the people (and
any custom feed URLs) to fetch. Reuses the RSS infra (parse_feed) and the shared
httpx layer + TTL cache. Sources per person: a Google News RSS *search* on the
name (free, no key, headlines link out) plus optional first-party feeds.
"""

from __future__ import annotations

import asyncio
import urllib.parse
from typing import Any

from ..cache import cache
from ..http import get_text
from ..models import FollowItem, NewsItem
from .base import Adapter, SourceUnavailable
from .rss import _UA, parse_feed

_PERSON_TTL = 1800.0  # 30 min — "daily catch-up", avoids hammering
_GOOGLE_NEWS = "Google News"


def google_news_search_url(name: str) -> str:
    """Exact-name Google News RSS search URL. Pure/testable."""
    q = urllib.parse.quote(f'"{name}"')
    return f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"


def derive_kind(url: str) -> str:
    """Classify an item by its source URL. Pure/testable."""
    u = url.lower()
    if "youtube.com" in u or "youtu.be" in u:
        return "video"
    if "news.google.com" in u:
        return "news"
    return "blog"


def to_follow_items(news: list[NewsItem], person: str, source_label: str) -> list[FollowItem]:
    """Convert canonical NewsItems -> FollowItems, tagging person/kind/source."""
    return [
        FollowItem(
            person=person,
            title=n.title,
            summary=n.summary,
            url=n.url,
            published_ts=n.published_ts,
            source=source_label,
            kind=derive_kind(n.url),
        )
        for n in news
    ]


def merge_dedupe_sort(items: list[FollowItem]) -> list[FollowItem]:
    """Dedupe by URL, sort newest-first (None publishedTs sinks last). Pure."""
    by_url: dict[str, FollowItem] = {}
    for it in items:
        if it.url and it.url not in by_url:
            by_url[it.url] = it
    return sorted(by_url.values(), key=lambda i: (i.published_ts is not None, i.published_ts or 0), reverse=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && ./.venv/bin/pytest tests/test_people.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/people.py api/tests/test_people.py
git commit -m "feat(people): pure helpers — search URL, kind, normalize, merge"
```

---

## Task 3: PeopleAdapter.get_person_feed + register + endpoint

**Files:**
- Modify: `api/app/adapters/people.py` (add the `PeopleAdapter` class)
- Modify: `api/app/deps.py`
- Modify: `api/app/routers.py`
- Test: `api/tests/test_people.py` (append a MockTransport test)

- [ ] **Step 1: Write the failing test**

Append to `api/tests/test_people.py`:

```python
import httpx
import pytest
from app.adapters.people import PeopleAdapter

_GNEWS_XML = """<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>PTJ on macro</title><link>https://news.google.com/rss/articles/a1</link>
<description>teaser</description><pubDate>Wed, 05 Jun 2024 12:00:00 GMT</pubDate></item>
</channel></rss>"""

_YT_XML = """<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>My talk</title><link>https://www.youtube.com/watch?v=abc</link>
<description>v</description><pubDate>Thu, 06 Jun 2024 12:00:00 GMT</pubDate></item>
</channel></rss>"""


async def test_get_person_feed_merges_news_and_custom_feed():
    def handler(req: httpx.Request) -> httpx.Response:
        if "news.google.com" in str(req.url):
            return httpx.Response(200, text=_GNEWS_XML)
        return httpx.Response(200, text=_YT_XML)

    adapter = PeopleAdapter()
    adapter._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    items = await adapter.get_person_feed("Paul Tudor Jones", ["https://youtube.com/feeds/x"])
    kinds = {i.kind for i in items}
    assert kinds == {"news", "video"}
    assert all(i.person == "Paul Tudor Jones" for i in items)
    assert items[0].published_ts >= (items[1].published_ts or 0)  # newest first
```

Note: `asyncio_mode = auto` is already set in `api/pytest.ini`, so async tests run without a decorator.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && ./.venv/bin/pytest tests/test_people.py::test_get_person_feed_merges_news_and_custom_feed -q`
Expected: FAIL — `AttributeError: 'PeopleAdapter' ... has no attribute` / class missing

- [ ] **Step 3: Add the adapter class**

Append to `api/app/adapters/people.py`. The optional `self._client` lets tests inject a `MockTransport`; in production each fetch uses the shared `get_text`.

```python
class PeopleAdapter(Adapter):
    name = "people"

    def __init__(self) -> None:
        self._client: Any = None  # tests may inject an httpx.AsyncClient (MockTransport)

    async def _fetch(self, url: str) -> str:
        return await get_text(url, source="people", client=self._client, headers={"User-Agent": _UA}, follow_redirects=True)

    async def get_person_feed(self, name: str, feeds: list[str] | None = None) -> list[FollowItem]:
        feeds = feeds or []
        sources: list[tuple[str, str]] = [(google_news_search_url(name), _GOOGLE_NEWS)]
        for f in feeds:
            label = "YouTube" if "youtube" in f.lower() else urllib.parse.urlparse(f).netloc or f
            sources.append((f, label))

        async def fetch_all() -> list[FollowItem]:
            async def one(url: str, label: str) -> list[FollowItem]:
                try:
                    xml = await self._fetch(url)
                except Exception:  # noqa: BLE001 - skip a single bad feed, keep the rest
                    return []
                return to_follow_items(parse_feed(xml, label), name, label)

            results = await asyncio.gather(*(one(u, l) for u, l in sources))
            flat = [it for sub in results for it in sub]
            if not flat:
                raise SourceUnavailable(f"No items found for {name}")
            return merge_dedupe_sort(flat)

        key = f"people:{name}:{','.join(sorted(feeds))}"
        return await cache.get_or_set(key, _PERSON_TTL, fetch_all)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && ./.venv/bin/pytest tests/test_people.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Register the adapter**

In `api/app/deps.py`, add the import and registration alongside the others:

```python
from .adapters.people import PeopleAdapter
```
```python
registry.register(PeopleAdapter())
```

- [ ] **Step 6: Add the endpoint**

In `api/app/routers.py`, add imports:

```python
from .adapters.people import PeopleAdapter
from .models import (
    ...,
    FeedError,
    FollowItem,
    PeopleFeedRequest,
    PeopleFeedResponse,
    PersonRef,
)
```

Add the endpoint (place near `/news`):

```python
@router.post("/people/feed", response_model=PeopleFeedResponse, tags=["people"])
async def people_feed(req: PeopleFeedRequest) -> PeopleFeedResponse:
    adapter = _adapter("people")
    if not isinstance(adapter, PeopleAdapter):
        return PeopleFeedResponse(status=SourceStatus.SOURCE_DOWN, message="people integration not available.")
    items: list[FollowItem] = []
    errors: list[FeedError] = []
    for p in req.people:
        try:
            person_items = await adapter.get_person_feed(p.name, p.feeds)
            items.extend(person_items[: req.limit_per_person])
        except Exception as exc:  # noqa: BLE001 - one person failing must not kill the rest
            _, msg = _status_from_exc(exc)
            errors.append(FeedError(person=p.name, message=msg))
    items = merge_people_items(items)
    if items:
        status = SourceStatus.OK
    elif errors:
        status = SourceStatus.SOURCE_DOWN
    else:
        status = SourceStatus.EMPTY
    return PeopleFeedResponse(status=status, items=items, errors=errors)
```

Add the merge import at the top of `routers.py`:

```python
from .adapters.people import PeopleAdapter, merge_dedupe_sort as merge_people_items
```

(Remove the duplicate `from .adapters.people import PeopleAdapter` if both appear — keep the single combined import line above.)

- [ ] **Step 7: Verify import + full backend tests**

Run: `cd api && ./.venv/bin/python -c "import app.main" && ./.venv/bin/pytest -q`
Expected: import OK; all tests pass (prior 24 + new ones).

- [ ] **Step 8: Live smoke (real Google News through the endpoint)**

Run:
```bash
cd api && (./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level warning &) ; sleep 3
curl -fsS -X POST http://127.0.0.1:8000/people/feed -H 'Content-Type: application/json' \
  -d '{"people":[{"name":"Andrej Karpathy","feeds":[]}]}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('status',d['status'],'items',len(d['items']));print(d['items'][0]['title'][:70] if d['items'] else 'none')"
pkill -f "uvicorn app.main"
```
Expected: `status ok items <N>` with a real headline.

- [ ] **Step 9: Commit**

```bash
git add api/app/adapters/people.py api/app/deps.py api/app/routers.py api/tests/test_people.py
git commit -m "feat(people): get_person_feed + POST /people/feed (stateless fan-out)"
```

---

## Task 4: Frontend command grammar (follow / unfollow / following)

**Files:**
- Modify: `web/app/lib/command/types.ts`
- Modify: `web/app/lib/command/parser.ts`
- Modify: `web/app/lib/command/tabs.ts`
- Test: `web/app/lib/command/parser.test.ts`, `web/app/lib/command/tabs.test.ts`

- [ ] **Step 1: Write the failing parser tests**

Append to `web/app/lib/command/parser.test.ts` (inside the existing `describe`):

```typescript
  it("parses `follow <multi-word name>` keeping the full name", () => {
    expect(parseCommand("follow Paul Tudor Jones")).toEqual({ kind: "follow", name: "Paul Tudor Jones" });
  });

  it("parses `unfollow <name>` and `following`", () => {
    expect(parseCommand("unfollow Andrej Karpathy")).toEqual({ kind: "unfollow", name: "Andrej Karpathy" });
    expect(parseCommand("following")).toEqual({ kind: "following" });
  });

  it("errors when follow has no name", () => {
    expect(parseCommand("follow").kind).toBe("error");
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run app/lib/command/parser.test.ts`
Expected: FAIL (follow parsed as error / mismatch)

- [ ] **Step 3: Extend the Command type**

In `web/app/lib/command/types.ts`, add to the `Command` union (before the `error` member):

```typescript
  | { kind: "follow"; name: string }
  | { kind: "unfollow"; name: string }
  | { kind: "following" }
```

Add `"following"` and `"person"` to `WidgetKind`:

```typescript
export type WidgetKind =
  | "chart"
  | "quote"
  | "watchlist"
  | "portfolio"
  | "yield"
  | "crypto"
  | "news"
  | "cal"
  | "help"
  | "following"
  | "person";
```

Add an optional `person` to `Tab`:

```typescript
export type Tab = {
  id: string;
  widget: WidgetKind;
  title: string;
  symbol?: string;
  pair?: string;
  feed?: string;
  person?: string;
};
```

Add a `Person` type (used by the store/widgets):

```typescript
// A followed person. `lastSeenTs` drives the "new since you last looked" badge.
export type Person = { name: string; feeds: string[]; lastSeenTs: number };
```

- [ ] **Step 4: Extend the parser**

In `web/app/lib/command/parser.ts`, add cases to the `switch (verb)` (before `default`). Names keep their original case (proper nouns):

```typescript
    case "follow":
    case "unfollow": {
      const name = args.join(" ").trim();
      if (!name) return err(input, `Usage: ${verb} <name>`);
      return { kind: verb, name };
    }
    case "following":
      return { kind: "following" };
```

- [ ] **Step 5: Run parser tests to verify pass**

Run: `cd web && npx vitest run app/lib/command/parser.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing tabs tests**

Append to `web/app/lib/command/tabs.test.ts` (inside the `describe`):

```typescript
  it("maps follow to a per-person tab and following to the roster", () => {
    expect(tabFor("follow Andrej Karpathy")).toMatchObject({
      id: "person:Andrej Karpathy", widget: "person", person: "Andrej Karpathy",
    });
    expect(tabFor("following")).toMatchObject({ id: "following", widget: "following" });
  });

  it("maps unfollow to the following roster tab", () => {
    expect(tabFor("unfollow Andrej Karpathy")).toMatchObject({ id: "following", widget: "following" });
  });
```

- [ ] **Step 7: Run to verify failure**

Run: `cd web && npx vitest run app/lib/command/tabs.test.ts`
Expected: FAIL

- [ ] **Step 8: Extend commandToTab**

In `web/app/lib/command/tabs.ts`, add cases to the `switch (cmd.kind)` (before `case "error"`):

```typescript
    case "follow":
      return { id: `person:${cmd.name}`, widget: "person", title: cmd.name, person: cmd.name };
    case "unfollow":
      return { id: "following", widget: "following", title: "Following" };
    case "following":
      return { id: "following", widget: "following", title: "Following" };
```

- [ ] **Step 9: Run all command tests**

Run: `cd web && npx vitest run app/lib/command/`
Expected: PASS (all parser/router/tabs tests)

- [ ] **Step 10: Commit**

```bash
git add web/app/lib/command/
git commit -m "feat(people): follow/unfollow/following command grammar + tabs"
```

---

## Task 5: Terminal store — following state, seed, persistence, actions

**Files:**
- Modify: `web/app/lib/store.ts`
- Test: `web/app/lib/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `web/app/lib/store.test.ts` (inside the `describe`):

```typescript
  it("seeds a default roster on first run", () => {
    const s = new TerminalStore();
    const names = s.getSnapshot().following.map((p) => p.name);
    expect(names).toEqual(["Paul Tudor Jones", "Stanley Druckenmiller", "Andrej Karpathy", "Boris Cherny"]);
  });

  it("follow adds a person (no dup) and opens their tab; unfollow removes", () => {
    const s = new TerminalStore();
    s.dispatch("follow Jensen Huang");
    expect(s.getSnapshot().following.some((p) => p.name === "Jensen Huang")).toBe(true);
    expect(s.getSnapshot().activeId).toBe("person:Jensen Huang");
    s.dispatch("follow Jensen Huang");
    expect(s.getSnapshot().following.filter((p) => p.name === "Jensen Huang")).toHaveLength(1);
    s.dispatch("unfollow Jensen Huang");
    expect(s.getSnapshot().following.some((p) => p.name === "Jensen Huang")).toBe(false);
  });

  it("markSeen updates lastSeenTs and persists the following list across a refresh", () => {
    const first = new TerminalStore();
    first.dispatch("follow Jensen Huang");
    first.markSeen("Jensen Huang");
    const seen = first.getSnapshot().following.find((p) => p.name === "Jensen Huang")!.lastSeenTs;
    expect(seen).toBeGreaterThan(0);
    const afterRefresh = new TerminalStore();
    expect(afterRefresh.getSnapshot().following.some((p) => p.name === "Jensen Huang")).toBe(true);
  });

  it("addPersonFeed attaches a feed URL to a person", () => {
    const s = new TerminalStore();
    s.dispatch("follow Jensen Huang");
    s.addPersonFeed("Jensen Huang", "https://example.com/rss.xml");
    const p = s.getSnapshot().following.find((x) => x.name === "Jensen Huang")!;
    expect(p.feeds).toContain("https://example.com/rss.xml");
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run app/lib/store.test.ts`
Expected: FAIL — `following` undefined / no `markSeen`

- [ ] **Step 3: Add `following` to state, seed, and persistence**

In `web/app/lib/store.ts`:

(a) Import `Person`:
```typescript
import type { Person, Tab } from "./command/types";
```

(b) Add `following` to `TerminalState`:
```typescript
export type TerminalState = {
  tabs: Tab[];
  activeId: string | null;
  watchlist: string[];
  following: Person[];
  history: string[];
  error: string | null;
};
```

(c) Add the default roster constant and include `following` in `SERVER_STATE`:
```typescript
const DEFAULT_FOLLOWING: Person[] = [
  { name: "Paul Tudor Jones", feeds: [], lastSeenTs: 0 },
  { name: "Stanley Druckenmiller", feeds: [], lastSeenTs: 0 },
  { name: "Andrej Karpathy", feeds: [], lastSeenTs: 0 },
  { name: "Boris Cherny", feeds: [], lastSeenTs: 0 },
];
```
In `SERVER_STATE`, add `following: []` (server snapshot stays empty; seeding happens client-side in `loadPersisted`).

(d) Extend `Persisted` and `loadPersisted`:
```typescript
type Persisted = Pick<TerminalState, "tabs" | "activeId" | "watchlist" | "following">;
```
In `loadPersisted`, the no-window and no-raw branches return the seed; an existing payload uses its `following` (even if `[]`, so unfollowing all is respected):
```typescript
function loadPersisted(): Persisted {
  if (typeof window === "undefined")
    return { tabs: [], activeId: null, watchlist: [], following: DEFAULT_FOLLOWING };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tabs: [], activeId: null, watchlist: [], following: DEFAULT_FOLLOWING };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [],
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      following: Array.isArray(parsed.following) ? parsed.following : DEFAULT_FOLLOWING,
    };
  } catch {
    return { tabs: [], activeId: null, watchlist: [], following: DEFAULT_FOLLOWING };
  }
}
```

(e) Persist `following` in `persist()`:
```typescript
  private persist() {
    if (typeof window === "undefined") return;
    try {
      const { tabs, activeId, watchlist, following } = this.state;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId, watchlist, following }));
    } catch {
      /* storage unavailable / quota — non-fatal */
    }
  }
```

- [ ] **Step 4: Wire follow/unfollow into `dispatch` and add actions**

In `dispatch`, after the `watch`/`unwatch` block and before computing `tab`, add following mutations:
```typescript
    let following = this.state.following;
    if (cmd.kind === "follow") {
      following = following.some((p) => p.name === cmd.name)
        ? following
        : [...following, { name: cmd.name, feeds: [], lastSeenTs: 0 }];
    } else if (cmd.kind === "unfollow") {
      following = following.filter((p) => p.name !== cmd.name);
    }
```
Then include `following` in the final `set(...)` of `dispatch`:
```typescript
    this.set({ tabs, activeId, watchlist, following, history, error: null });
```
(Also add `following` to the early `error` return and any other `set` calls — those use `...this.state`, which already carries `following`, so only the explicit object literals need the field.)

Add public actions (after `clearError`):
```typescript
  followPerson(name: string) {
    this.dispatch(`follow ${name}`);
  }

  unfollowPerson(name: string) {
    this.dispatch(`unfollow ${name}`);
  }

  addPersonFeed(name: string, url: string) {
    const following = this.state.following.map((p) =>
      p.name === name && !p.feeds.includes(url) ? { ...p, feeds: [...p.feeds, url] } : p,
    );
    this.set({ ...this.state, following });
  }

  // Mark a person (or "*" for all) as seen now; drives the "new" badge.
  markSeen(name: string) {
    const now = Date.now();
    const following = this.state.following.map((p) =>
      name === "*" || p.name === name ? { ...p, lastSeenTs: now } : p,
    );
    this.set({ ...this.state, following });
  }
```

Note: `Date.now()` is fine here — this is application code, not a workflow script.

- [ ] **Step 5: Run store tests**

Run: `cd web && npx vitest run app/lib/store.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/app/lib/store.ts web/app/lib/store.test.ts
git commit -m "feat(people): following state — seed, persist, follow/unfollow/seen actions"
```

---

## Task 6: Loader + regenerate typed client

**Files:**
- Modify: `web/app/lib/loaders.ts`
- Modify: `web/app/lib/api/client.ts`
- Regenerate: `web/app/lib/api/schema.ts`

- [ ] **Step 1: Regenerate the schema from the running backend**

Run:
```bash
cd api && (./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level warning &) ; sleep 3
cd ../web && npm run gen:api
pkill -f "uvicorn app.main"
grep -c "FollowItem\|PeopleFeedResponse" app/lib/api/schema.ts
```
Expected: a count ≥ 2 (the new models present in `schema.ts`).

- [ ] **Step 2: Export the new types from the client**

In `web/app/lib/api/client.ts`, after the other type re-exports:
```typescript
export type FollowItem = Schemas["FollowItem"];
export type PeopleFeedResponse = Schemas["PeopleFeedResponse"];
```
(`Person` is a frontend type from `command/types.ts`; do not duplicate it here.)

- [ ] **Step 3: Add the loader**

In `web/app/lib/loaders.ts`, add an import for the `Person` type and the loader:
```typescript
import type { Person } from "./command/types";
```
```typescript
export async function loadPeopleFeed(people: Person[]): Promise<Schemas["PeopleFeedResponse"]> {
  const { data, error } = await api.POST("/people/feed", {
    body: { people: people.map((p) => ({ name: p.name, feeds: p.feeds })) },
  });
  return unwrap(data, error);
}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/api/schema.ts web/app/lib/api/client.ts web/app/lib/loaders.ts
git commit -m "feat(people): typed loadPeopleFeed + regenerated schema"
```

---

## Task 7: FollowingWidget (roster + aggregated feed)

**Files:**
- Create: `web/app/widgets/FollowingWidget.tsx`

- [ ] **Step 1: Create the widget**

```tsx
// web/app/widgets/FollowingWidget.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import { loadPeopleFeed } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useTerminal } from "../lib/useTerminal";
import { terminalStore } from "../lib/store";
import type { FollowItem } from "../lib/api/client";

function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

export default function FollowingWidget() {
  const { following } = useTerminal();
  const key = following.map((p) => `${p.name}:${p.feeds.join("|")}`).join(",");
  // Capture lastSeen per person at mount so "new" badges persist for the session.
  const seenAtMount = useMemo(
    () => Object.fromEntries(following.map((p) => [p.name, p.lastSeenTs])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [filter, setFilter] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    const r = await loadPeopleFeed(following);
    terminalStore.markSeen("*"); // mark seen after the fetch resolves
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const { state, refresh } = useResource(load);

  return (
    <WidgetFrame title="Following" onRefresh={refresh} busy={state.kind === "loading"}>
      {/* roster */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.6rem" }}>
        {following.map((p) => (
          <span key={p.name} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", border: "1px solid var(--border)", borderRadius: 999, padding: "0.2rem 0.6rem", fontSize: "0.78rem" }}>
            <button onClick={() => setFilter(filter === p.name ? null : p.name)} title="filter to this person"
              style={{ background: "none", border: "none", color: filter === p.name ? "var(--accent)" : "var(--foreground)", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
              {p.name}
            </button>
            <button onClick={() => terminalStore.dispatch(`follow ${p.name}`)} title="open feed"
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}>↗</button>
            <button onClick={() => terminalStore.unfollowPerson(p.name)} title="unfollow"
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}>✕</button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem" }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="follow someone…"
          onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { terminalStore.followPerson(newName.trim()); setNewName(""); } }}
          style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontFamily: "inherit", fontSize: "0.85rem", padding: "0.3rem 0.6rem" }} />
        <button onClick={() => { if (newName.trim()) { terminalStore.followPerson(newName.trim()); setNewName(""); } }}
          style={{ background: "transparent", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.3rem 0.7rem", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem" }}>+ follow</button>
      </div>

      {following.length === 0 && <p style={{ color: "var(--muted)" }}>Not following anyone. Try <code>follow Andrej Karpathy</code>.</p>}

      <ResourceView state={state}>
        {(data) => {
          const items: FollowItem[] = filter ? data.items.filter((i) => i.person === filter) : data.items;
          return (
            <div>
              {data.errors.length > 0 && (
                <p style={{ color: "#d9a441", fontSize: "0.78rem", marginBottom: "0.6rem" }}>
                  couldn’t reach: {data.errors.map((e) => e.person).join(", ")}
                </p>
              )}
              {items.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>No recent items.</p>
              ) : (
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                  {items.map((item, i) => {
                    const isNew = (item.publishedTs ?? 0) > (seenAtMount[item.person] ?? 0);
                    return (
                      <li key={`${item.url}-${i}`} style={{ borderTop: i ? "1px solid var(--border)" : "none", paddingTop: i ? "0.9rem" : 0 }}>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "1rem" }}>
                          {isNew && <span style={{ color: "var(--accent)", marginRight: "0.4rem" }}>●</span>}
                          {item.title}
                        </a>
                        {item.summary && <p style={{ color: "var(--muted)", margin: "0.25rem 0" }}>{item.summary}</p>}
                        <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                          {item.person} · {item.kind} · {item.source} · {timeAgo(item.publishedTs)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        }}
      </ResourceView>
    </WidgetFrame>
  );
}
```

- [ ] **Step 2: Lint the file**

Run: `cd web && npx eslint app/widgets/FollowingWidget.tsx`
Expected: no errors (the two `eslint-disable` comments cover the intentional deps choices).

- [ ] **Step 3: Commit**

```bash
git add web/app/widgets/FollowingWidget.tsx
git commit -m "feat(people): FollowingWidget — roster + aggregated feed + new badges"
```

---

## Task 8: PersonFeedWidget + host/help/README wiring

**Files:**
- Create: `web/app/widgets/PersonFeedWidget.tsx`
- Modify: `web/app/components/WidgetHost.tsx`
- Modify: `web/app/widgets/HelpWidget.tsx`
- Modify: `README.md`

- [ ] **Step 1: Create PersonFeedWidget**

```tsx
// web/app/widgets/PersonFeedWidget.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import { loadPeopleFeed } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useTerminal } from "../lib/useTerminal";
import { terminalStore } from "../lib/store";

function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

export default function PersonFeedWidget({ person }: { person: string }) {
  const { following } = useTerminal();
  const entry = following.find((p) => p.name === person) ?? { name: person, feeds: [], lastSeenTs: 0 };
  const key = `${entry.name}:${entry.feeds.join("|")}`;
  const seenAtMount = useMemo(() => entry.lastSeenTs, [/* mount only */]); // eslint-disable-line react-hooks/exhaustive-deps
  const [feedUrl, setFeedUrl] = useState("");

  const load = useCallback(async () => {
    const r = await loadPeopleFeed([entry]);
    terminalStore.markSeen(person);
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const { state, refresh } = useResource(load);

  const isFollowed = useMemo(() => following.some((p) => p.name === person), [following, person]);

  return (
    <WidgetFrame title={`Following · ${person}`} onRefresh={refresh} busy={state.kind === "loading"}>
      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        {!isFollowed && (
          <button onClick={() => terminalStore.followPerson(person)}
            style={{ background: "transparent", color: "var(--accent)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.25rem 0.7rem", cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem" }}>+ follow</button>
        )}
        <input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="attach a feed URL (blog / YouTube)…"
          onKeyDown={(e) => { if (e.key === "Enter" && feedUrl.trim()) { terminalStore.addPersonFeed(person, feedUrl.trim()); setFeedUrl(""); refresh(); } }}
          style={{ flex: 1, minWidth: 200, background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontFamily: "inherit", fontSize: "0.8rem", padding: "0.25rem 0.5rem" }} />
        <button onClick={() => { if (feedUrl.trim()) { terminalStore.addPersonFeed(person, feedUrl.trim()); setFeedUrl(""); refresh(); } }}
          style={{ background: "transparent", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.25rem 0.7rem", cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem" }}>+ feed</button>
      </div>
      {entry.feeds.length > 0 && (
        <p style={{ color: "var(--muted)", fontSize: "0.75rem", marginBottom: "0.8rem" }}>feeds: {entry.feeds.join(", ")}</p>
      )}
      <ResourceView state={state}>
        {(data) =>
          data.items.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No recent items for {person}.</p>
          ) : (
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              {data.items.map((item, i) => {
                const isNew = (item.publishedTs ?? 0) > seenAtMount;
                return (
                  <li key={`${item.url}-${i}`} style={{ borderTop: i ? "1px solid var(--border)" : "none", paddingTop: i ? "0.9rem" : 0 }}>
                    <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "1rem" }}>
                      {isNew && <span style={{ color: "var(--accent)", marginRight: "0.4rem" }}>●</span>}
                      {item.title}
                    </a>
                    {item.summary && <p style={{ color: "var(--muted)", margin: "0.25rem 0" }}>{item.summary}</p>}
                    <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{item.kind} · {item.source} · {timeAgo(item.publishedTs)}</span>
                  </li>
                );
              })}
            </ul>
          )
        }
      </ResourceView>
    </WidgetFrame>
  );
}
```

- [ ] **Step 2: Route the new widgets in WidgetHost**

In `web/app/components/WidgetHost.tsx`, add imports:
```typescript
import FollowingWidget from "../widgets/FollowingWidget";
import PersonFeedWidget from "../widgets/PersonFeedWidget";
```
Add cases to the `switch (tab.widget)` (before the closing brace):
```typescript
    case "following":
      return <FollowingWidget />;
    case "person":
      return <PersonFeedWidget person={tab.person!} />;
```

- [ ] **Step 3: Add the commands to Help**

In `web/app/widgets/HelpWidget.tsx`, add rows to the `COMMANDS` array (after the `news` row):
```typescript
  ["follow <name>", "Follow a person; opens their feed (news, interviews, talks)"],
  ["unfollow <name>", "Stop following a person"],
  ["following", "Manage who you follow + see the aggregated feed"],
```

- [ ] **Step 4: Document in README**

In `README.md`, add rows to the commands table (after the `news` row):
```markdown
| `follow <name>` / `unfollow <name>` | follow/unfollow a person (e.g. `follow Andrej Karpathy`) |
| `following` | roster + aggregated feed of followed people's public items |
```
And add a short paragraph under the commands table:
```markdown
**Follow People:** aggregates public items about/by the people you follow — news,
articles, interviews, podcasts/talks — from a free Google News search per person
plus any first-party feeds (blog/YouTube) you attach. On-demand + cached; a "●"
marks items newer than your last visit. The follow-list persists in `localStorage`.
```

- [ ] **Step 5: Lint, typecheck, test, build**

Run:
```bash
cd web
npx eslint app/widgets/PersonFeedWidget.tsx app/components/WidgetHost.tsx
npx tsc --noEmit
npx vitest run
npm run build
```
Expected: eslint clean; tsc clean; all vitest pass; build OK.

- [ ] **Step 6: Commit**

```bash
git add web/app/widgets/PersonFeedWidget.tsx web/app/components/WidgetHost.tsx web/app/widgets/HelpWidget.tsx README.md
git commit -m "feat(people): PersonFeedWidget + host/help/README wiring"
```

---

## Task 9: Full-stack verification

**Files:** none (verification only)

- [ ] **Step 1: Backend tests + import**

Run: `cd api && ./.venv/bin/python -c "import app.main" && ./.venv/bin/pytest -q`
Expected: import OK; all pytest pass.

- [ ] **Step 2: Frontend gate**

Run: `cd web && npm run lint && npx vitest run && npm run build`
Expected: all green.

- [ ] **Step 3: Live end-to-end through the proxy**

Run:
```bash
cd api && (./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level warning &) ; sleep 3
cd ../web && (npm run dev >/tmp/web.log 2>&1 &) ; sleep 8
curl -fsS -X POST http://127.0.0.1:3000/api/people/feed -H 'Content-Type: application/json' \
  -d '{"people":[{"name":"Paul Tudor Jones","feeds":[]},{"name":"Andrej Karpathy","feeds":[]}]}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('status',d['status'],'items',len(d['items']),'errors',len(d['errors']))"
pkill -f "next dev"; pkill -f "next-server"; pkill -f "uvicorn app.main"
```
Expected: `status ok items <N> errors 0` — real aggregated items across both people through the Next proxy.

- [ ] **Step 4: Confirm no secrets staged, clean tree**

Run: `cd /home/brian/omphalos && git status --porcelain && git add -A --dry-run | grep -E "/\\.env$" || echo "no .env (good)"`
Expected: clean (everything already committed); no `.env`.

---

## Self-review notes (addressed)

- **Spec coverage:** commands (T4), data model (T1), backend adapter+endpoint (T2–3), follow-list persistence+seed+seen (T5), loader/types (T6), roster+aggregated feed+per-person tabs (T7–8), error/empty states (ResourceView + `errors[]` rendering in T7/T8), README (T8). All covered.
- **Type consistency:** `FollowItem`/`PersonRef`/`PeopleFeedRequest`/`PeopleFeedResponse`/`FeedError` defined in T1 and used identically in T3/T6; `Person` defined in T4 and used in T5–8; `markSeen`/`followPerson`/`unfollowPerson`/`addPersonFeed` defined in T5 and called in T7/T8; `get_person_feed(name, feeds)` defined T3, called T3 endpoint.
- **No placeholders:** every code step is complete; the two `eslint-disable` comments are intentional and explained.
