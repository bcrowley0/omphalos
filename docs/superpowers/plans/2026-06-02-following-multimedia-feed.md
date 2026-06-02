# Following — Multimedia Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a followed person's feed auto-aggregate their multimedia output — YouTube videos, podcasts, public speeches, and long-form writing — with per-person toggles + anchors, instead of being news-headline-centric.

**Architecture:** Extend the existing `PeopleAdapter` with keyless auto-discovery for podcasts (iTunes Search API) and YouTube (channel-search-page → `channelId` → channel RSS), an optional per-type anchor that overrides the auto-guess, and a `classify_speech` pass that upgrades talk-like video/audio items to `kind="speech"`. The per-person profile (`enabled` toggles + `anchors`) is defined in Pydantic (`PersonRef`), the TS client is regenerated from OpenAPI, and the frontend store migrates legacy `feeds[]` into the new shape. A per-person settings popover on each roster chip drives toggles/anchors; `FeedItemList` gains per-kind labels and a kind-filter chip row.

**Tech Stack:** FastAPI / Python 3.14 / pydantic-settings / httpx (backend); Next.js / TypeScript / React / vitest / openapi-typescript + openapi-fetch (frontend). All new sources are keyless.

**Spec:** `docs/superpowers/specs/2026-06-02-following-multimedia-feed-design.md`

---

## File Structure

**Backend (`api/`):**
- Modify `app/adapters/people.py` — new pure helpers (`classify_speech`, `classify_feed_url`, `itunes_search_url`, `youtube_search_url`, `channel_rss_url`, `parse_itunes_podcasts`, `extract_channel_id`, `apply_speech_classification`), a `kind` override on `to_follow_items`, new I/O resolvers (`resolve_youtube_anchor`, `discover_youtube_channel`), and a rewritten `get_person_feed(person: PersonRef)`.
- Modify `app/models.py` — `PersonAnchors` + reshaped `PersonRef`; widen `FollowItem.kind` doc.
- Modify `app/routers.py` — `/people/feed` passes the whole `PersonRef`.
- Modify `tests/test_people.py`, `tests/test_people_models.py` — new + updated tests.

**Frontend (`web/`):**
- Modify `app/lib/api/schema.ts` — regenerated (do not hand-edit).
- Modify `app/lib/command/types.ts` — `ContentType`, `PersonAnchors`, reshaped `Person`.
- Modify `app/lib/store.ts` — migration + mutators; update `tests` `store.test.ts`.
- Add `app/lib/feedUrl.ts` — `classifyFeedUrl` (UI-only categorization for migration/validation).
- Modify `app/lib/loaders.ts` — send `{ name, enabled, anchors }`.
- Modify `app/components/FeedItemList.tsx` — per-kind label + `KindFilterChips`.
- Modify `app/widgets/FollowingWidget.tsx` — per-person settings popover + kind filtering.

---

## Task 1: Pure classifiers & URL builders

**Files:**
- Modify: `api/app/adapters/people.py`
- Test: `api/tests/test_people.py`

- [ ] **Step 1: Write the failing tests**

Add to `api/tests/test_people.py`:

```python
from app.adapters.people import (
    channel_rss_url,
    classify_feed_url,
    classify_speech,
    itunes_search_url,
    youtube_search_url,
)


def test_classify_speech_detects_talks():
    assert classify_speech("Jensen Huang Keynote at GTC 2024")
    assert classify_speech("Andrej Karpathy: a talk on neural nets")
    assert classify_speech("Druckenmiller fireside chat at the Economic Club")
    assert classify_speech("Full interview with Paul Tudor Jones")
    assert not classify_speech("Nvidia ships new GPU")
    assert not classify_speech("My weekend coding stream")


def test_classify_feed_url_routes_by_host():
    assert classify_feed_url("https://www.youtube.com/@karpathy") == "youtube"
    assert classify_feed_url("https://youtu.be/abc") == "youtube"
    assert classify_feed_url("@karpathy") == "youtube"  # bare handle
    assert classify_feed_url("https://feeds.megaphone.fm/show") == "podcast"
    assert classify_feed_url("https://podcasts.apple.com/us/podcast/x/id123") == "podcast"
    assert classify_feed_url("https://karpathy.github.io/feed.xml") == "writing"


def test_itunes_search_url_encodes_name():
    url = itunes_search_url("Paul Tudor Jones")
    assert url.startswith("https://itunes.apple.com/search?")
    assert "media=podcast" in url
    assert "Paul%20Tudor%20Jones" in url


def test_youtube_search_url_filters_to_channels():
    url = youtube_search_url("Andrej Karpathy")
    assert url.startswith("https://www.youtube.com/results?")
    assert "search_query=" in url
    assert "Andrej%20Karpathy" in url
    assert "sp=" in url  # channel-type filter present


def test_channel_rss_url_builds_feed():
    assert channel_rss_url("UC123") == "https://www.youtube.com/feeds/videos.xml?channel_id=UC123"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && python -m pytest tests/test_people.py -k "classify_speech or classify_feed_url or itunes_search_url or youtube_search_url or channel_rss_url" -v`
Expected: FAIL — `ImportError: cannot import name 'classify_speech'`.

- [ ] **Step 3: Add the helpers to `api/app/adapters/people.py`**

Add near the other pure helpers (after `derive_kind`):

```python
# Talk/speech keywords: a video OR podcast item whose title matches is a "speech".
_SPEECH_KEYWORDS = (
    "keynote", "talk", "lecture", "fireside", "interview", "testimony",
    "address", "speaks at", "conference", "summit", "panel", "commencement",
    "q&a", "qanda", "remarks", "speech",
)


def classify_speech(title: str) -> bool:
    """True if a video/audio title looks like a talk/speech. Pure/testable."""
    t = title.lower()
    return any(kw in t for kw in _SPEECH_KEYWORDS)


def classify_feed_url(url: str) -> str:
    """Route an attached/anchored URL to 'youtube' | 'podcast' | 'writing'. Pure."""
    u = url.lower().strip()
    if u.startswith("@") or "youtube.com" in u or "youtu.be" in u:
        return "youtube"
    if "podcasts.apple.com" in u or "megaphone" in u or "libsyn" in u or "/podcast" in u or "feeds.simplecast" in u:
        return "podcast"
    return "writing"


def itunes_search_url(name: str) -> str:
    """Keyless iTunes podcast search for a person's shows. Pure/testable."""
    q = urllib.parse.quote(name)
    return f"https://itunes.apple.com/search?media=podcast&entity=podcast&limit=5&term={q}"


def youtube_search_url(name: str) -> str:
    """YouTube results page filtered to channels (sp=EgIQAg) for name->channel
    discovery. Pure/testable."""
    q = urllib.parse.quote(name)
    return f"https://www.youtube.com/results?search_query={q}&sp=EgIQAg%3D%3D"


def channel_rss_url(channel_id: str) -> str:
    """YouTube channel uploads RSS. Pure/testable."""
    return f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && python -m pytest tests/test_people.py -k "classify_speech or classify_feed_url or itunes_search_url or youtube_search_url or channel_rss_url" -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/people.py api/tests/test_people.py
git commit -m "feat(people): pure classifiers + URL builders for multimedia feed"
```

---

## Task 2: `parse_itunes_podcasts` (name-gated JSON parse)

**Files:**
- Modify: `api/app/adapters/people.py`
- Test: `api/tests/test_people.py`

- [ ] **Step 1: Write the failing test**

```python
import json

from app.adapters.people import parse_itunes_podcasts


def test_parse_itunes_podcasts_keeps_only_name_matched_shows():
    body = json.dumps({
        "results": [
            {"feedUrl": "https://a/feed", "artistName": "Andrej Karpathy", "collectionName": "AK Pod"},
            {"feedUrl": "https://b/feed", "artistName": "Some Other Host", "collectionName": "Tech Daily"},
            {"feedUrl": "https://c/feed", "artistName": "Lex", "collectionName": "Karpathy & Friends"},
            {"artistName": "Andrej Karpathy", "collectionName": "No Feed URL"},  # dropped: no feedUrl
        ]
    })
    feeds = parse_itunes_podcasts(body, "Andrej Karpathy")
    assert feeds == ["https://a/feed", "https://c/feed"]  # surname or full-name match; order preserved


def test_parse_itunes_podcasts_handles_garbage():
    assert parse_itunes_podcasts("not json", "X") == []
    assert parse_itunes_podcasts(json.dumps({"results": []}), "X") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_people.py -k parse_itunes_podcasts -v`
Expected: FAIL — `ImportError`.

- [ ] **Step 3: Add the helper**

`parse_itunes_podcasts` reuses `title_mentions_person` (already in the module) for the name gate:

```python
import json as _json  # add to imports at top of file


def parse_itunes_podcasts(body: str, name: str) -> list[str]:
    """Extract podcast feed URLs from an iTunes Search response, keeping only shows
    whose artist/collection name plausibly matches the person. Pure/testable."""
    try:
        data = _json.loads(body)
    except (ValueError, TypeError):
        return []
    feeds: list[str] = []
    for r in data.get("results", []):
        feed = r.get("feedUrl")
        if not feed:
            continue
        haystack = f"{r.get('artistName', '')} {r.get('collectionName', '')}"
        if title_mentions_person(haystack, name):
            feeds.append(feed)
    return feeds
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_people.py -k parse_itunes_podcasts -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/people.py api/tests/test_people.py
git commit -m "feat(people): name-gated iTunes podcast discovery parse"
```

---

## Task 3: `extract_channel_id` (HTML parse)

**Files:**
- Modify: `api/app/adapters/people.py`
- Test: `api/tests/test_people.py`

- [ ] **Step 1: Write the failing test**

```python
from app.adapters.people import extract_channel_id


def test_extract_channel_id_from_ytinitialdata():
    html = 'foo <script>var x = {"channelId":"UCabc123DEFghi456jkl789"};</script> bar'
    assert extract_channel_id(html) == "UCabc123DEFghi456jkl789"


def test_extract_channel_id_from_canonical_link():
    html = '<link rel="canonical" href="https://www.youtube.com/channel/UCxyz789abc123def456ghi">'
    assert extract_channel_id(html) == "UCxyz789abc123def456ghi"


def test_extract_channel_id_none_when_absent():
    assert extract_channel_id("<html>no channel here</html>") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_people.py -k extract_channel_id -v`
Expected: FAIL — `ImportError`.

- [ ] **Step 3: Add the helper**

```python
_CHANNEL_ID_RE = re.compile(r'"channelId":"(UC[0-9A-Za-z_-]{20,})"')
_CANONICAL_CHANNEL_RE = re.compile(r'/channel/(UC[0-9A-Za-z_-]{20,})')


def extract_channel_id(html: str) -> str | None:
    """Pull a YouTube channelId from a channel or search-results page. Tries the
    embedded ytInitialData "channelId" first, then a /channel/UC… canonical link.
    Pure/testable."""
    m = _CHANNEL_ID_RE.search(html)
    if m:
        return m.group(1)
    m = _CANONICAL_CHANNEL_RE.search(html)
    return m.group(1) if m else None
```

(`re` is already imported at the top of `people.py`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_people.py -k extract_channel_id -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/people.py api/tests/test_people.py
git commit -m "feat(people): extract YouTube channelId from page HTML"
```

---

## Task 4: `to_follow_items` kind override + `apply_speech_classification`

**Files:**
- Modify: `api/app/adapters/people.py`
- Test: `api/tests/test_people.py`

- [ ] **Step 1: Write the failing tests**

```python
from app.adapters.people import apply_speech_classification, to_follow_items as _tfi


def test_to_follow_items_kind_override_forces_podcast():
    news = [NewsItem(title="Ep 12: macro", summary="", url="https://feeds.x/ep12",
                     published_ts=1, feed="Show")]
    items = _tfi(news, "Paul Tudor Jones", "Macro Show", kind_override="podcast")
    assert items[0].kind == "podcast"


def test_apply_speech_classification_upgrades_video_and_podcast():
    mk = lambda kind, title: FollowItem(person="P", title=title, summary="", url=f"u-{title}",
                                        published_ts=1, source="s", kind=kind)
    items = [
        mk("video", "GTC Keynote 2024"),
        mk("video", "Random vlog"),
        mk("podcast", "Fireside chat with P"),
        mk("news", "Keynote recap article"),  # news is NOT upgraded
    ]
    out = apply_speech_classification(items)
    kinds = [i.kind for i in out]
    assert kinds == ["speech", "video", "speech", "news"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_people.py -k "kind_override or apply_speech" -v`
Expected: FAIL — `ImportError` / unexpected `kind_override` kwarg.

- [ ] **Step 3: Modify `to_follow_items` and add `apply_speech_classification`**

Change the `to_follow_items` signature and `kind` assignment:

```python
def to_follow_items(news: list[NewsItem], person: str, source_label: str,
                    kind_override: str | None = None) -> list[FollowItem]:
    """Convert canonical NewsItems -> FollowItems, tagging person/kind/source and
    classifying primary vs secondary. `kind_override` forces the kind (e.g. podcast
    feeds, whose URLs would otherwise classify as 'blog'). ..."""
    first_party = source_label != _GOOGLE_NEWS
    items: list[FollowItem] = []
    for n in news:
        if first_party:
            title, publisher, primary, relevant = n.title, source_label, True, True
        else:
            title, publisher = extract_publisher(n.title)
            primary = is_primary_publisher(publisher)
            relevant = title_mentions_person(title, person)
        items.append(
            FollowItem(
                person=person,
                title=title,
                summary=n.summary,
                url=n.url,
                published_ts=n.published_ts,
                source=source_label,
                kind=kind_override or derive_kind(n.url),
                publisher=publisher,
                primary=primary,
                relevant=relevant,
            )
        )
    return items
```

Add after it:

```python
def apply_speech_classification(items: list[FollowItem]) -> list[FollowItem]:
    """Upgrade talk-like video/audio items to kind='speech'. Pure/testable."""
    out: list[FollowItem] = []
    for it in items:
        if it.kind in ("video", "podcast") and classify_speech(it.title):
            out.append(it.model_copy(update={"kind": "speech"}))
        else:
            out.append(it)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_people.py -k "kind_override or apply_speech" -v`
Expected: PASS (2 tests). Run the whole file to confirm no regression: `python -m pytest tests/test_people.py -v` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/people.py api/tests/test_people.py
git commit -m "feat(people): kind override + speech classification pass"
```

---

## Task 5: I/O resolvers — `resolve_youtube_anchor` & `discover_youtube_channel`

**Files:**
- Modify: `api/app/adapters/people.py`
- Test: `api/tests/test_people.py`

- [ ] **Step 1: Write the failing tests**

```python
from app.adapters.people import channel_rss_url

_CID = "UCabcdefghij0123456789"  # 20 chars after "UC" (matches the channelId regex)


async def test_resolve_youtube_anchor_direct_channel_id_skips_network():
    adapter = PeopleAdapter()  # no _client set: any fetch would raise
    assert await adapter.resolve_youtube_anchor(_CID) == channel_rss_url(_CID)
    assert await adapter.resolve_youtube_anchor(
        f"https://www.youtube.com/channel/{_CID}"
    ) == channel_rss_url(_CID)


async def test_resolve_youtube_anchor_handle_fetches_and_extracts():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"] = str(req.url)
        return httpx.Response(200, text=f'<script>{{"channelId":"{_CID}"}}</script>')

    adapter = PeopleAdapter()
    adapter._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    assert await adapter.resolve_youtube_anchor("@karpathy") == channel_rss_url(_CID)
    assert seen["url"] == "https://www.youtube.com/@karpathy"


async def test_discover_youtube_channel_requires_name_match():
    nomatch = f'<script>{{"channelId":"{_CID}","title":"Cooking Daily"}}</script>'
    match = f'<script>{{"channelId":"{_CID}","title":"Andrej Karpathy"}}</script>'

    def mk(page):
        def handler(req: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text=page)
        a = PeopleAdapter()
        a._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        return a

    assert await mk(nomatch).discover_youtube_channel("Andrej Karpathy") is None
    assert await mk(match).discover_youtube_channel("Andrej Karpathy") == channel_rss_url(_CID)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_people.py -k "resolve_youtube_anchor or discover_youtube_channel" -v`
Expected: FAIL — `AttributeError: 'PeopleAdapter' object has no attribute 'resolve_youtube_anchor'`.

- [ ] **Step 3: Add a long TTL, the title regex, and the resolver methods**

Add near the top constants:

```python
_RESOLVE_TTL = 86400.0  # 24h — a handle->channelId mapping rarely changes
_CHANNEL_TITLE_RE = re.compile(r'"channelId":"UC[0-9A-Za-z_-]{20,}".{0,200}?"title":"([^"]+)"')
```

Add methods to `PeopleAdapter` (after `_fetch`):

```python
    async def resolve_youtube_anchor(self, anchor: str) -> str | None:
        """@handle / channel URL / channelId -> channel uploads RSS. A bare
        channelId and a /channel/UC… URL skip the network; an @handle fetches the
        channel page once (cached)."""
        a = anchor.strip()
        if a.startswith("UC") and "/" not in a and " " not in a:
            return channel_rss_url(a)
        cid = extract_channel_id(a)  # catches /channel/UC… inside a pasted URL
        if cid:
            return channel_rss_url(cid)

        async def fetch() -> str | None:
            url = a if a.startswith("http") else "https://www.youtube.com/" + (a if a.startswith("@") else "@" + a)
            try:
                html = await self._fetch(url)
            except Exception:  # noqa: BLE001
                return None
            resolved = extract_channel_id(html)
            return channel_rss_url(resolved) if resolved else None

        return await cache.get_or_set(f"yt-anchor:{a}", _RESOLVE_TTL, fetch)

    async def discover_youtube_channel(self, name: str) -> str | None:
        """Best-effort name -> channel uploads RSS via the public channel-search
        page. Accept ONLY if the top channel's title matches the person's name;
        otherwise return None (no wrong-person noise). Cached long-TTL."""
        async def fetch() -> str | None:
            try:
                html = await self._fetch(youtube_search_url(name))
            except Exception:  # noqa: BLE001
                return None
            cid = extract_channel_id(html)
            if not cid:
                return None
            m = _CHANNEL_TITLE_RE.search(html)
            title = m.group(1) if m else ""
            if not title_mentions_person(title, name):
                return None
            return channel_rss_url(cid)

        return await cache.get_or_set(f"yt-discover:{name}", _RESOLVE_TTL, fetch)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_people.py -k "resolve_youtube_anchor or discover_youtube_channel" -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/people.py api/tests/test_people.py
git commit -m "feat(people): YouTube anchor resolve + name-gated channel discovery"
```

---

## Task 6: Reshape `PersonRef` / `PersonAnchors` + widen `FollowItem.kind`

**Files:**
- Modify: `api/app/models.py:238-258`
- Test: `api/tests/test_people_models.py`

- [ ] **Step 1: Write the failing test**

Add to `api/tests/test_people_models.py`:

```python
from app.models import PersonAnchors, PersonRef


def test_person_ref_defaults_empty_profile():
    p = PersonRef(name="Andrej Karpathy")
    assert p.enabled == {}
    assert p.anchors.youtube is None
    assert p.anchors.podcast is None
    assert p.anchors.writing == []


def test_person_ref_round_trips_profile_with_camel_aliases():
    p = PersonRef.model_validate({
        "name": "AK",
        "enabled": {"news": False, "videos": True},
        "anchors": {"youtube": "@karpathy", "writing": ["https://blog/feed"]},
    })
    assert p.enabled["news"] is False
    assert p.anchors.youtube == "@karpathy"
    assert p.anchors.writing == ["https://blog/feed"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_people_models.py -k person_ref -v`
Expected: FAIL — `ImportError: cannot import name 'PersonAnchors'`.

- [ ] **Step 3: Reshape the models**

In `api/app/models.py`, replace the `PersonRef` class (lines ~251-253) with:

```python
class PersonAnchors(CamelModel):
    youtube: str | None = None   # @handle | channel URL | channelId — locks the channel
    podcast: str | None = None   # podcast feed URL — locks the show
    writing: list[str] = []      # blog/Substack/Medium RSS — writing's only source


class PersonRef(CamelModel):
    name: str
    # Per-content-type on/off. Missing key => default-on, EXCEPT "writing" which is
    # on iff an anchor exists. Keys: news | videos | podcasts | speeches | writing.
    enabled: dict[str, bool] = {}
    anchors: PersonAnchors = PersonAnchors()
```

And widen the `FollowItem.kind` comment (line ~245):

```python
    kind: str  # "news" | "video" | "podcast" | "blog" | "speech"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_people_models.py -v`
Expected: PASS (all model tests).

- [ ] **Step 5: Commit**

```bash
git add api/app/models.py api/tests/test_people_models.py
git commit -m "feat(people): PersonRef profile (enabled + anchors); widen FollowItem.kind"
```

---

## Task 7: Rewrite `get_person_feed(person: PersonRef)`

**Files:**
- Modify: `api/app/adapters/people.py:174-197`
- Test: `api/tests/test_people.py:144-172` (rewrite the two adapter tests)

- [ ] **Step 1: Rewrite the two existing adapter tests + add coverage**

Replace `test_get_person_feed_merges_news_and_custom_feed` and `test_get_person_feed_skips_a_failing_feed` with:

```python
from app.models import PersonAnchors, PersonRef

_ITUNES_JSON = '{"results":[{"feedUrl":"https://pod/feed","artistName":"Paul Tudor Jones","collectionName":"PTJ Pod"}]}'
_POD_XML = """<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Ep 1: macro outlook</title><link>https://pod/ep1</link>
<description>p</description><pubDate>Fri, 07 Jun 2024 12:00:00 GMT</pubDate></item>
</channel></rss>"""


def _route(req: httpx.Request) -> httpx.Response:
    u = str(req.url)
    if "news.google.com" in u:
        return httpx.Response(200, text=_GNEWS_XML)
    if "itunes.apple.com" in u:
        return httpx.Response(200, text=_ITUNES_JSON)
    if "pod/feed" in u:
        return httpx.Response(200, text=_POD_XML)
    if "youtube.com/feeds/videos.xml" in u:
        return httpx.Response(200, text=_YT_XML)
    if "youtube.com/results" in u:  # discovery: matching channel
        return httpx.Response(200, text='{"channelId":"UCptj00000000000000000","title":"Paul Tudor Jones"}')
    return httpx.Response(404, text="nope")


def _adapter_with(handler):
    a = PeopleAdapter()
    a._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return a


async def test_get_person_feed_aggregates_enabled_sources():
    adapter = _adapter_with(_route)
    # speeches OFF so the shared _YT_XML ("My talk") stays kind=video for this assertion;
    # speech classification has its own test below.
    person = PersonRef(name="Paul Tudor Jones", enabled={"speeches": False})
    items = await adapter.get_person_feed(person)
    kinds = {i.kind for i in items}
    assert "news" in kinds
    assert "podcast" in kinds       # auto iTunes discovery
    assert "video" in kinds         # auto YouTube discovery (name-matched)
    assert all(i.person == "Paul Tudor Jones" for i in items)


async def test_get_person_feed_respects_disabled_toggles():
    adapter = _adapter_with(_route)
    person = PersonRef(name="Paul Tudor Jones",
                       enabled={"videos": False, "podcasts": False, "speeches": True})
    items = await adapter.get_person_feed(person)
    assert {i.kind for i in items} == {"news"}


async def test_get_person_feed_uses_youtube_anchor_over_discovery():
    person = PersonRef(name="Paul Tudor Jones",
                       enabled={"news": False, "podcasts": False},
                       anchors=PersonAnchors(youtube="UCanchor00000000000000"))
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"] = str(req.url)
        return httpx.Response(200, text=_YT_XML)

    adapter = _adapter_with(handler)
    items = await adapter.get_person_feed(person)
    assert "channel_id=UCanchor00000000000000" in seen["url"]  # anchor used, no discovery fetch
    assert all(i.kind in ("video", "speech") for i in items)


async def test_get_person_feed_skips_a_failing_source():
    def handler(req: httpx.Request) -> httpx.Response:
        if "news.google.com" in str(req.url):
            return httpx.Response(200, text=_GNEWS_XML)
        raise httpx.ConnectError("boom", request=req)  # podcast/video sources fail

    adapter = _adapter_with(handler)
    items = await adapter.get_person_feed(PersonRef(name="Paul Tudor Jones"))
    assert len(items) >= 1
    assert any(i.kind == "news" for i in items)


async def test_get_person_feed_classifies_speeches():
    speech_xml = _YT_XML.replace("My talk", "GTC Keynote 2024")

    def handler(req: httpx.Request) -> httpx.Response:
        if "youtube.com/feeds/videos.xml" in str(req.url):
            return httpx.Response(200, text=speech_xml)
        return httpx.Response(404, text="x")

    person = PersonRef(name="Paul Tudor Jones",
                       enabled={"news": False, "podcasts": False},
                       anchors=PersonAnchors(youtube="UCkeynote0000000000000"))
    adapter = _adapter_with(handler)
    items = await adapter.get_person_feed(person)
    assert any(i.kind == "speech" for i in items)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && python -m pytest tests/test_people.py -k get_person_feed -v`
Expected: FAIL — `get_person_feed()` takes `(name, feeds)`, not a `PersonRef`.

- [ ] **Step 3: Rewrite `get_person_feed` and add per-source helpers**

In `people.py`, add `from ..models import FollowItem, NewsItem, PersonRef` (add `PersonRef`). Replace the whole `get_person_feed` method with:

```python
    def _enabled(self, person: PersonRef, kind: str) -> bool:
        if kind == "writing":
            return person.enabled.get("writing", bool(person.anchors.writing))
        return person.enabled.get(kind, True)

    async def _feed_items(self, url: str, name: str, label: str, kind_override: str | None) -> list[FollowItem]:
        try:
            xml = await self._fetch(url)
        except Exception:  # noqa: BLE001 - one bad feed never kills the rest
            return []
        return to_follow_items(parse_feed(xml, label), name, label, kind_override=kind_override)

    async def _video_items(self, name: str, anchor: str | None) -> list[FollowItem]:
        rss = await self.resolve_youtube_anchor(anchor) if anchor else await self.discover_youtube_channel(name)
        if not rss:
            return []
        return await self._feed_items(rss, name, "YouTube", kind_override=None)

    async def _podcast_items(self, name: str, anchor: str | None) -> list[FollowItem]:
        if anchor:
            feeds = [anchor]
        else:
            try:
                body = await self._fetch(itunes_search_url(name))
            except Exception:  # noqa: BLE001
                return []
            feeds = parse_itunes_podcasts(body, name)
        results = await asyncio.gather(
            *(self._feed_items(f, name, "Podcast", kind_override="podcast") for f in feeds)
        )
        return [it for sub in results for it in sub]

    async def get_person_feed(self, person: PersonRef) -> list[FollowItem]:
        name = person.name
        anchors = person.anchors
        tasks: list[Any] = []
        if self._enabled(person, "news"):
            tasks.append(self._feed_items(google_news_search_url(name), name, _GOOGLE_NEWS, None))
        if self._enabled(person, "videos"):
            tasks.append(self._video_items(name, anchors.youtube))
        if self._enabled(person, "podcasts"):
            tasks.append(self._podcast_items(name, anchors.podcast))
        if self._enabled(person, "writing"):
            for url in anchors.writing:
                label = urllib.parse.urlparse(url).netloc or url
                tasks.append(self._feed_items(url, name, label, None))

        speeches_on = self._enabled(person, "speeches")
        cache_key = (
            f"people:{name}:"
            f"{sorted(person.enabled.items())}:"
            f"{anchors.youtube}:{anchors.podcast}:{','.join(sorted(anchors.writing))}"
        )

        async def fetch_all() -> list[FollowItem]:
            results = await asyncio.gather(*tasks)
            flat = [it for sub in results for it in sub]
            if not flat:
                raise SourceUnavailable(f"No items found for {name}")
            flat = dedupe_stories(merge_dedupe_sort(flat))
            if speeches_on:
                flat = apply_speech_classification(flat)
            return flat

        return await cache.get_or_set(cache_key, _PERSON_TTL, fetch_all)
```

(Note: `_feed_items` uses `parse_feed`, already imported; `Any` is already imported.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && python -m pytest tests/test_people.py -v`
Expected: PASS (all, including the 6 `get_person_feed` tests).

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/people.py api/tests/test_people.py
git commit -m "feat(people): aggregate videos/podcasts/writing + speeches per profile"
```

---

## Task 8: Router `/people/feed` passes the profile

**Files:**
- Modify: `api/app/routers.py:277-279`
- Test: `api/tests/test_people.py`

- [ ] **Step 1: Write the failing test**

Add an endpoint test (uses FastAPI `TestClient`; mirror however other router tests construct the client — check `tests/conftest.py` for an existing `client` fixture):

```python
def test_people_feed_endpoint_accepts_profile(client):
    resp = client.post("/api/people/feed", json={
        "people": [{
            "name": "Paul Tudor Jones",
            "enabled": {"videos": False, "podcasts": False},
            "anchors": {"writing": []},
        }],
        "limitPerPerson": 25,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body and "errors" in body
```

> If there is no `client` fixture, skip this endpoint test and rely on Task 7's adapter coverage + the type-check in Step 4; note the gap in the commit message.

- [ ] **Step 2: Run test to verify it fails (or errors on the old call signature)**

Run: `cd api && python -m pytest tests/test_people.py -k people_feed_endpoint -v`
Expected: FAIL — handler still calls `adapter.get_person_feed(p.name, p.feeds)`.

- [ ] **Step 3: Update the handler**

In `api/app/routers.py`, change the call inside `people_feed` (line ~279):

```python
            person_items = await adapter.get_person_feed(p)
```

(`p` is now a full `PersonRef`. No other lines in the handler change.)

- [ ] **Step 4: Run tests + type-check**

Run: `cd api && python -m pytest tests/test_people.py -v && python -m pytest tests/ -q`
Expected: PASS (whole suite green).

- [ ] **Step 5: Commit**

```bash
git add api/app/routers.py api/tests/test_people.py
git commit -m "feat(people): /people/feed passes full PersonRef profile"
```

---

## Task 9: Regenerate the TypeScript client from OpenAPI

**Files:**
- Modify: `web/app/lib/api/schema.ts` (generated — do not hand-edit)

- [ ] **Step 1: Start the backend** (in a separate terminal)

Run: `cd api && uvicorn app.main:app --host 127.0.0.1 --port 8000`
(Or use the repo's `./dev.sh` if it starts the API.) Leave it running.

- [ ] **Step 2: Regenerate types**

Run: `cd web && npm run gen:api`
Expected: `app/lib/api/schema.ts` rewritten with no errors.

- [ ] **Step 3: Verify the new shape landed**

Run: `cd web && grep -n "PersonAnchors\|enabled\|anchors" app/lib/api/schema.ts | head`
Expected: `PersonRef` now has `enabled` and `anchors`; a `PersonAnchors` schema exists.

- [ ] **Step 4: Confirm the frontend build now FAILS (proof the contract is wired)**

Run: `cd web && npx tsc --noEmit 2>&1 | head`
Expected: type errors in `loaders.ts` (sending `feeds`) — this is the intended break that Tasks 11-14 fix. Do not "fix" it by editing `schema.ts`.

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/api/schema.ts
git commit -m "chore(web): regenerate OpenAPI client for PersonRef profile"
```

---

## Task 10: Frontend `feedUrl.ts` — `classifyFeedUrl`

**Files:**
- Create: `web/app/lib/feedUrl.ts`
- Test: `web/app/lib/feedUrl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/app/lib/feedUrl.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyFeedUrl } from "./feedUrl";

describe("classifyFeedUrl", () => {
  it("routes youtube handles and urls", () => {
    expect(classifyFeedUrl("@karpathy")).toBe("youtube");
    expect(classifyFeedUrl("https://www.youtube.com/@karpathy")).toBe("youtube");
    expect(classifyFeedUrl("https://youtu.be/abc")).toBe("youtube");
  });
  it("routes podcast feeds", () => {
    expect(classifyFeedUrl("https://feeds.megaphone.fm/show")).toBe("podcast");
    expect(classifyFeedUrl("https://podcasts.apple.com/us/podcast/x/id1")).toBe("podcast");
  });
  it("routes everything else to writing", () => {
    expect(classifyFeedUrl("https://karpathy.github.io/feed.xml")).toBe("writing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/lib/feedUrl.test.ts`
Expected: FAIL — cannot resolve `./feedUrl`.

- [ ] **Step 3: Create `web/app/lib/feedUrl.ts`**

```ts
// UI-only categorization of a pasted source URL/handle (migration + validation).
// Mirrors the backend's classify_feed_url; this is not a response shape.
export type FeedKind = "youtube" | "podcast" | "writing";

export function classifyFeedUrl(url: string): FeedKind {
  const u = url.toLowerCase().trim();
  if (u.startsWith("@") || u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (
    u.includes("podcasts.apple.com") ||
    u.includes("megaphone") ||
    u.includes("libsyn") ||
    u.includes("/podcast") ||
    u.includes("feeds.simplecast")
  )
    return "podcast";
  return "writing";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/lib/feedUrl.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/feedUrl.ts web/app/lib/feedUrl.test.ts
git commit -m "feat(web): classifyFeedUrl helper for source categorization"
```

---

## Task 11: Reshape the `Person` type

**Files:**
- Modify: `web/app/lib/command/types.ts:44-45`

- [ ] **Step 1: Replace the `Person` type**

In `web/app/lib/command/types.ts`, replace line 45:

```ts
// A followed person. `lastSeenTs` drives the "new since you last looked" badge.
export type ContentType = "news" | "videos" | "podcasts" | "speeches" | "writing";

export type PersonAnchors = {
  youtube?: string;
  podcast?: string;
  writing: string[];
};

export type Person = {
  name: string;
  lastSeenTs: number;
  enabled: Partial<Record<ContentType, boolean>>;
  anchors: PersonAnchors;
};
```

- [ ] **Step 2: Verify it compiles in isolation**

Run: `cd web && npx tsc --noEmit 2>&1 | grep "command/types" || echo "types.ts clean"`
Expected: `types.ts clean` (other files still error until Tasks 12-14 — expected).

- [ ] **Step 3: Commit**

```bash
git add web/app/lib/command/types.ts
git commit -m "feat(web): Person type with enabled toggles + anchors"
```

---

## Task 12: Store migration + mutators

**Files:**
- Modify: `web/app/lib/store.ts`
- Test: `web/app/lib/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `web/app/lib/store.test.ts` (it already has `// @vitest-environment jsdom` at the top, so `window.localStorage` works):

```ts
it("migrates legacy {feeds} persons into enabled + anchors", () => {
  window.localStorage.setItem(
    "omphalos.terminal.v1",
    JSON.stringify({
      tabs: [], activeId: null, watchlist: [],
      following: [{ name: "AK", feeds: ["@karpathy", "https://blog/feed.xml"], lastSeenTs: 5 }],
    }),
  );
  const s = new TerminalStore();
  const ak = s.getSnapshot().following.find((p) => p.name === "AK")!;
  expect(ak.anchors.youtube).toBe("@karpathy");
  expect(ak.anchors.writing).toContain("https://blog/feed.xml");
  expect(ak.enabled.writing).toBe(true);
  expect(ak.lastSeenTs).toBe(5);
});

it("default roster has profile shape", () => {
  const s = new TerminalStore();
  const p = s.getSnapshot().following[0];
  expect(p.anchors.writing).toEqual([]);
  expect(p.enabled).toBeDefined();
});

it("setPersonEnabled toggles a content type", () => {
  const s = new TerminalStore();
  const name = s.getSnapshot().following[0].name;
  s.setPersonEnabled(name, "videos", false);
  expect(s.getSnapshot().following[0].enabled.videos).toBe(false);
});

it("setPersonAnchor and writing-feed add/remove", () => {
  const s = new TerminalStore();
  const name = s.getSnapshot().following[0].name;
  s.setPersonAnchor(name, "youtube", "@handle");
  expect(s.getSnapshot().following[0].anchors.youtube).toBe("@handle");
  s.addWritingFeed(name, "https://x/feed");
  expect(s.getSnapshot().following[0].anchors.writing).toContain("https://x/feed");
  s.removeWritingFeed(name, "https://x/feed");
  expect(s.getSnapshot().following[0].anchors.writing).not.toContain("https://x/feed");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run app/lib/store.test.ts`
Expected: FAIL — migration absent / `setPersonEnabled` not a function.

- [ ] **Step 3: Update `store.ts`**

Add a `classifyFeedUrl` import at the top, and extend the existing
`import type { Person, Tab } from "./command/types";` (line 3) to also import
`ContentType`:

```ts
import { classifyFeedUrl } from "./feedUrl";
import type { ContentType, Person, Tab } from "./command/types";
```

Add a migration helper above `loadPersisted`:

```ts
function migratePerson(raw: unknown): Person {
  const p = (raw ?? {}) as Record<string, unknown>;
  const name = String(p.name ?? "");
  const lastSeenTs = typeof p.lastSeenTs === "number" ? p.lastSeenTs : 0;
  // Already-new shape: pass through.
  if (p.enabled && p.anchors) {
    return { name, lastSeenTs, enabled: p.enabled as Person["enabled"], anchors: p.anchors as Person["anchors"] };
  }
  const feeds = Array.isArray(p.feeds) ? (p.feeds as string[]) : [];
  const anchors: Person["anchors"] = { writing: [] };
  for (const url of feeds) {
    const kind = classifyFeedUrl(url);
    if (kind === "youtube" && !anchors.youtube) anchors.youtube = url;
    else if (kind === "podcast" && !anchors.podcast) anchors.podcast = url;
    else anchors.writing.push(url);
  }
  return {
    name,
    lastSeenTs,
    enabled: { news: true, videos: true, podcasts: true, speeches: true, writing: anchors.writing.length > 0 },
    anchors,
  };
}
```

Update `DEFAULT_FOLLOWING` to the new shape:

```ts
const mkPerson = (name: string): Person => ({
  name,
  lastSeenTs: 0,
  enabled: { news: true, videos: true, podcasts: true, speeches: true, writing: false },
  anchors: { writing: [] },
});

const DEFAULT_FOLLOWING: Person[] = [
  "Paul Tudor Jones", "Stanley Druckenmiller", "Andrej Karpathy", "Boris Cherny",
].map(mkPerson);
```

In `loadPersisted`, run migration on the parsed list:

```ts
      following: Array.isArray(parsed.following) ? (parsed.following as unknown[]).map(migratePerson) : DEFAULT_FOLLOWING,
```

In `dispatch`, the `follow` branch creates a new person — replace the inline object:

```ts
      following = following.some((p) => p.name === cmd.name)
        ? following
        : [...following, mkPerson(cmd.name)];
```

Replace `addPersonFeed` with the new mutators:

```ts
  setPersonEnabled(name: string, type: ContentType, on: boolean) {
    const following = this.state.following.map((p) =>
      p.name === name ? { ...p, enabled: { ...p.enabled, [type]: on } } : p,
    );
    this.set({ ...this.state, following });
  }

  setPersonAnchor(name: string, type: "youtube" | "podcast", value: string | null) {
    const following = this.state.following.map((p) =>
      p.name === name ? { ...p, anchors: { ...p.anchors, [type]: value ?? undefined } } : p,
    );
    this.set({ ...this.state, following });
  }

  addWritingFeed(name: string, url: string) {
    const following = this.state.following.map((p) =>
      p.name === name && !p.anchors.writing.includes(url)
        ? { ...p, anchors: { ...p.anchors, writing: [...p.anchors.writing, url] }, enabled: { ...p.enabled, writing: true } }
        : p,
    );
    this.set({ ...this.state, following });
  }

  removeWritingFeed(name: string, url: string) {
    const following = this.state.following.map((p) =>
      p.name === name
        ? { ...p, anchors: { ...p.anchors, writing: p.anchors.writing.filter((u) => u !== url) } }
        : p,
    );
    this.set({ ...this.state, following });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run app/lib/store.test.ts`
Expected: PASS (existing + 4 new tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/store.ts web/app/lib/store.test.ts
git commit -m "feat(web): migrate Person to profile shape + toggle/anchor mutators"
```

---

## Task 13: `loadPeopleFeed` sends the profile

**Files:**
- Modify: `web/app/lib/loaders.ts:64-69`

- [ ] **Step 1: Update the loader**

Replace the body mapping:

```ts
export async function loadPeopleFeed(people: Person[]): Promise<Schemas["PeopleFeedResponse"]> {
  const { data, error } = await api.POST("/people/feed", {
    body: {
      people: people.map((p) => ({ name: p.name, enabled: p.enabled, anchors: p.anchors })),
      limitPerPerson: 25,
    },
  });
  return unwrap(data, error);
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit 2>&1 | grep "loaders.ts" || echo "loaders.ts clean"`
Expected: `loaders.ts clean` (FollowingWidget/FeedItemList may still error until Tasks 14-15).

- [ ] **Step 3: Commit**

```bash
git add web/app/lib/loaders.ts
git commit -m "feat(web): send per-person profile to /people/feed"
```

---

## Task 14: `FeedItemList` — per-kind label + kind filter

> **Project test convention:** this repo tests **pure functions only**, in node env, via `*.test.ts` (no `@testing-library/react` — it isn't installed, and `.test.tsx` isn't in the vitest `include`). So we extract the testable logic into pure exports (`KIND_LABEL`, `presentKinds`) and unit-test those; the presentational `KindFilterChips` component is covered by `tsc` + the Task 16 smoke test, not by a render test.

**Files:**
- Modify: `web/app/components/FeedItemList.tsx`
- Test: `web/app/components/feedKinds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/app/components/feedKinds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { KIND_LABEL, presentKinds } from "./FeedItemList";
import type { FollowItem } from "../lib/api/client";

const mk = (kind: string): FollowItem =>
  ({ person: "P", title: "t", summary: "", url: `u-${kind}`, publishedTs: 1,
     source: "s", kind, publisher: null, primary: true, relevant: true } as FollowItem);

describe("presentKinds", () => {
  it("returns distinct kinds in first-appearance order", () => {
    expect(presentKinds([mk("video"), mk("news"), mk("video")])).toEqual(["video", "news"]);
  });
  it("is empty for no items", () => {
    expect(presentKinds([])).toEqual([]);
  });
});

describe("KIND_LABEL", () => {
  it("maps the canonical blog kind to the Writing label", () => {
    expect(KIND_LABEL.blog).toBe("Writing");
    expect(KIND_LABEL.speech).toBe("Speech");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/components/feedKinds.test.ts`
Expected: FAIL — `presentKinds` / `KIND_LABEL` not exported.

- [ ] **Step 3: Update `FeedItemList.tsx`**

Add the label map + pure helper + chips component near the top (after imports):

```tsx
export const KIND_LABEL: Record<string, string> = {
  news: "News",
  video: "Video",
  podcast: "Podcast",
  speech: "Speech",
  blog: "Writing",
};

// Distinct kinds present in `items`, in first-appearance order. Pure/testable.
export function presentKinds(items: FollowItem[]): string[] {
  const out: string[] = [];
  for (const i of items) if (!out.includes(i.kind)) out.push(i.kind);
  return out;
}

// A chip row of the kinds actually present, plus "All". Hidden when ≤1 kind.
export function KindFilterChips({
  items,
  active,
  onPick,
}: {
  items: FollowItem[];
  active: string | null;
  onPick: (kind: string | null) => void;
}) {
  const kinds = presentKinds(items);
  if (kinds.length <= 1) return null;
  const chip = (label: string, value: string | null, on: boolean) => (
    <button key={label} onClick={() => onPick(value)}
      style={{ background: on ? "var(--panel)" : "transparent", color: on ? "var(--accent)" : "var(--muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "0.15rem 0.6rem", cursor: "pointer", fontFamily: "inherit", fontSize: "0.74rem" }}>
      {label}
    </button>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.7rem" }}>
      {chip("All", null, active === null)}
      {kinds.map((k) => chip(KIND_LABEL[k] ?? k, k, active === k))}
    </div>
  );
}
```

In `FeedItemList`'s byline `<span>`, add the kind label before the publisher:

```tsx
          <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
            {showPerson && `${item.person} · `}
            <span style={{ color: "var(--accent)" }}>{KIND_LABEL[item.kind] ?? item.kind}</span>
            {" · "}{item.publisher ?? item.source}
            {item.primary ? "" : " · secondary"} · {timeAgo(item.publishedTs)}
          </span>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/components/feedKinds.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/components/FeedItemList.tsx web/app/components/feedKinds.test.ts
git commit -m "feat(web): per-kind labels + kind-filter chips in FeedItemList"
```

---

## Task 15: `FollowingWidget` — per-person settings popover + kind filtering

**Files:**
- Modify: `web/app/widgets/FollowingWidget.tsx`

- [ ] **Step 1: Add a `PersonSettings` popover component (top of file, after imports)**

`useState` is already imported by the widget. Add the type import below to the
existing imports, then add the components that follow above `FollowingWidget`:

```tsx
import type { ContentType, Person } from "../lib/command/types";

const CONTENT_TYPES: { key: ContentType; label: string }[] = [
  { key: "news", label: "News" },
  { key: "videos", label: "Videos" },
  { key: "podcasts", label: "Podcasts" },
  { key: "speeches", label: "Speeches" },
  { key: "writing", label: "Writing" },
];

function PersonSettings({ person }: { person: Person }) {
  const [open, setOpen] = useState(false);
  const [yt, setYt] = useState(person.anchors.youtube ?? "");
  const [pod, setPod] = useState(person.anchors.podcast ?? "");
  const [writeUrl, setWriteUrl] = useState("");
  const en = (t: ContentType) => person.enabled[t] ?? (t === "writing" ? person.anchors.writing.length > 0 : true);

  return (
    <span style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} title="sources & toggles"
        style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}>⚙</button>
      {open && (
        <div style={{ position: "absolute", zIndex: 10, top: "1.4rem", right: 0, width: 260, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.7rem", fontSize: "0.8rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "0.6rem" }}>
            {CONTENT_TYPES.map((c) => (
              <label key={c.key} style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }}>
                {c.label}
                <input type="checkbox" checked={en(c.key)}
                  onChange={(e) => terminalStore.setPersonEnabled(person.name, c.key, e.target.checked)} />
              </label>
            ))}
          </div>
          <AnchorInput label="YouTube @handle / URL" value={yt} setValue={setYt}
            onCommit={(v) => terminalStore.setPersonAnchor(person.name, "youtube", v || null)} />
          <AnchorInput label="Podcast feed URL" value={pod} setValue={setPod}
            onCommit={(v) => terminalStore.setPersonAnchor(person.name, "podcast", v || null)} />
          <div style={{ marginTop: "0.5rem" }}>
            <div style={{ color: "var(--muted)", marginBottom: "0.25rem" }}>Writing feeds</div>
            {person.anchors.writing.map((u) => (
              <div key={u} style={{ display: "flex", justifyContent: "space-between", gap: "0.4rem" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u}</span>
                <button onClick={() => terminalStore.removeWritingFeed(person.name, u)}
                  style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>✕</button>
              </div>
            ))}
            <input value={writeUrl} onChange={(e) => setWriteUrl(e.target.value)} placeholder="add RSS URL…"
              onKeyDown={(e) => { if (e.key === "Enter" && writeUrl.trim()) { terminalStore.addWritingFeed(person.name, writeUrl.trim()); setWriteUrl(""); } }}
              style={{ width: "100%", marginTop: "0.3rem", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontFamily: "inherit", fontSize: "0.8rem", padding: "0.25rem 0.5rem" }} />
          </div>
        </div>
      )}
    </span>
  );
}

function AnchorInput({ label, value, setValue, onCommit }: {
  label: string; value: string; setValue: (v: string) => void; onCommit: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: "0.4rem" }}>
      <div style={{ color: "var(--muted)", marginBottom: "0.2rem" }}>{label}</div>
      <input value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => onCommit(value.trim())}
        onKeyDown={(e) => { if (e.key === "Enter") onCommit(value.trim()); }}
        placeholder="auto-discover"
        style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontFamily: "inherit", fontSize: "0.8rem", padding: "0.25rem 0.5rem" }} />
    </div>
  );
}
```

- [ ] **Step 2: Add the gear to each roster chip and a kind filter to the feed**

In the roster chip (inside the `following.map`), add `<PersonSettings person={p} />` next to the existing buttons. Add kind-filter state near the other `useState`s:

```tsx
  const [kindFilter, setKindFilter] = useState<string | null>(null);
```

Import `KindFilterChips`:

```tsx
import { CuratedToggle, FeedItemList, KindFilterChips } from "../components/FeedItemList";
```

In the `ResourceView` render, apply the kind filter and show the chips. Replace the `scoped`/`items` computation and the render block:

```tsx
          const byPerson: FollowItem[] = filter ? data.items.filter((i) => i.person === filter) : data.items;
          const scoped = kindFilter ? byPerson.filter((i) => i.kind === kindFilter) : byPerson;
          const items = curated ? scoped.filter((i) => i.primary && i.relevant) : scoped;
          const hidden = scoped.length - scoped.filter((i) => i.primary && i.relevant).length;
          return (
            <div>
              <KindFilterChips items={byPerson} active={kindFilter} onPick={setKindFilter} />
              <CuratedToggle curated={curated} hidden={hidden} onToggle={() => setCurated(!curated)} onShowAll={() => setCurated(false)} />
              {/* …unchanged errors + empty + FeedItemList… */}
```

(Keep the existing `errors`, empty-state, and `FeedItemList` lines as-is below this.)

- [ ] **Step 3: Type-check + full frontend build**

Run: `cd web && npx tsc --noEmit`
Expected: no errors (the contract break from Task 9 is now fully resolved).

- [ ] **Step 4: Run the full frontend test suite**

Run: `cd web && npm test`
Expected: all PASS (79 prior + new tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/widgets/FollowingWidget.tsx
git commit -m "feat(web): per-person source settings popover + kind filter in Following"
```

---

## Task 16: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Backend suite green**

Run: `cd api && python -m pytest tests/ -q`
Expected: all PASS.

- [ ] **Step 2: Frontend suite + build green**

Run: `cd web && npm test && npx tsc --noEmit && npm run build`
Expected: all tests PASS; type-check clean; production build succeeds.

- [ ] **Step 3: Manual smoke (with backend + frontend running)**

Run the app (`./dev.sh` or the two servers). In the command bar: `follow Andrej Karpathy`. Open the gear on his chip, paste his YouTube `@handle`, and confirm the feed shows Video/Speech items alongside News; toggle Podcasts off and confirm podcast items disappear on refresh; click the kind-filter chips and confirm scoping.

- [ ] **Step 4: Commit any smoke-fix tweaks**

```bash
git add -A && git commit -m "fix(following): smoke-test adjustments"  # only if needed
```

---

## Notes for the implementer

- **TLS / keyless:** all new hosts (`itunes.apple.com`, `www.youtube.com`) are public HTTPS with valid certs — they use the normal shared `httpx` layer (`get_text`), NOT the IBKR no-verify path. No secrets, nothing added to `api/.env`.
- **Fault isolation is load-bearing:** every per-source coroutine swallows its own exception and returns `[]`. Never let one bad feed raise out of `get_person_feed` except the final "all sources empty" → `SourceUnavailable` (which the router maps to a clean per-person `FeedError`).
- **Do not hand-edit `web/app/lib/api/schema.ts`** — it is regenerated in Task 9. A backend field change must break the frontend build; that is the intended contract.
- **Cache keys** must include the full profile (enabled + anchors), or a toggle change won't refetch. Task 7's `cache_key` does this.
