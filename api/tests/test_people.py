import json

import httpx

from app.adapters.people import (
    PeopleAdapter,
    apply_speech_classification,
    channel_rss_url,
    classify_feed_url,
    classify_speech,
    dedupe_stories,
    derive_kind,
    extract_channel_id,
    extract_publisher,
    google_news_search_url,
    is_primary_publisher,
    itunes_search_url,
    merge_dedupe_sort,
    parse_itunes_podcasts,
    title_mentions_person,
    to_follow_items,
    youtube_search_url,
)
from app.models import FollowItem, NewsItem


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


def test_classify_speech_detects_talks():
    assert classify_speech("Jensen Huang Keynote at GTC 2024")
    assert classify_speech("Andrej Karpathy: a talk on neural nets")
    assert classify_speech("Druckenmiller fireside chat at the Economic Club")
    assert classify_speech("Full interview with Paul Tudor Jones")
    assert not classify_speech("Nvidia ships new GPU")
    assert not classify_speech("My weekend coding stream")


def test_classify_speech_no_substring_false_positives():
    assert not classify_speech("They were talking about markets")
    assert not classify_speech("New MAC address assigned")
    assert not classify_speech("This API is addressable via REST")


def test_classify_speech_address_is_context_sensitive():
    assert classify_speech("Presidential address to the nation")
    assert classify_speech("State of the Union address")
    assert not classify_speech("New MAC address assigned")
    assert not classify_speech("Configure the IP address")


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


def test_title_mentions_person_full_name_or_surname():
    assert title_mentions_person("Nvidia chief Jensen Huang to join board", "Jensen Huang")
    assert title_mentions_person("What Huang said at Computex", "Jensen Huang")  # surname only
    assert not title_mentions_person("Key themes to watch at Asia's biggest AI show", "Jensen Huang")


def test_to_follow_items_sets_relevant_from_title_for_google_news():
    news = [
        NewsItem(title="Jensen Huang joins board - Reuters", summary="",
                 url="https://news.google.com/rss/articles/1", published_ts=2, feed="Google News"),
        NewsItem(title="Nvidia to spend $150B in Taiwan - Reuters", summary="",
                 url="https://news.google.com/rss/articles/2", published_ts=1, feed="Google News"),
    ]
    items = to_follow_items(news, "Jensen Huang", "Google News")
    assert items[0].relevant is True
    assert items[1].relevant is False


def test_to_follow_items_first_party_always_relevant():
    news = [NewsItem(title="some talk", summary="", url="https://www.youtube.com/watch?v=1",
                     published_ts=1, feed="YouTube")]
    assert to_follow_items(news, "Andrej Karpathy", "YouTube")[0].relevant is True


def test_dedupe_stories_collapses_near_duplicate_titles():
    def mk(title, pub, ts, url):
        return FollowItem(person="P", title=title, summary="", url=url, published_ts=ts,
                          source="Google News", kind="news", publisher=pub, primary=True, relevant=True)

    a = mk("Nvidia chief Jensen Huang to join board of Beijing's Tsinghua University", "Reuters", 100, "u1")
    b = mk("Nvidia chief Jensen Huang to join board at prestigious Beijing university", "Financial Times", 90, "u2")
    c = mk("Nvidia to spend $150 billion a year in Taiwan", "Reuters", 80, "u3")
    out = dedupe_stories([a, b, c])
    titles = [i.title for i in out]
    assert len(out) == 2  # the board story (Reuters + FT) collapses to one
    assert sum(1 for t in titles if "board" in t.lower()) == 1
    assert any("Taiwan" in t for t in titles)


def test_extract_publisher_splits_google_news_suffix():
    assert extract_publisher("Nvidia hits record - Reuters") == ("Nvidia hits record", "Reuters")
    assert extract_publisher("No suffix here") == ("No suffix here", None)
    # only the LAST ' - ' is the separator
    assert extract_publisher("A - B story - CNBC") == ("A - B story", "CNBC")


def test_is_primary_publisher_allowlist():
    assert is_primary_publisher("Reuters")
    assert is_primary_publisher("Bloomberg.com")  # substring match
    assert is_primary_publisher("The Wall Street Journal")
    assert is_primary_publisher("Financial Times")
    assert is_primary_publisher("PR Newswire")
    assert not is_primary_publisher("Yahoo Finance")
    assert not is_primary_publisher("The Motley Fool")
    assert not is_primary_publisher(None)


def test_to_follow_items_marks_google_news_by_publisher_and_cleans_title():
    news = [
        NewsItem(title="Jensen says X - Reuters", summary="s",
                 url="https://news.google.com/rss/articles/1", published_ts=10, feed="Google News"),
        NewsItem(title="Hot take - The Motley Fool", summary="s",
                 url="https://news.google.com/rss/articles/2", published_ts=9, feed="Google News"),
    ]
    items = to_follow_items(news, person="Jensen Huang", source_label="Google News")
    assert items[0].title == "Jensen says X"
    assert items[0].publisher == "Reuters"
    assert items[0].primary is True
    assert items[1].publisher == "The Motley Fool"
    assert items[1].primary is False


def test_to_follow_items_first_party_always_primary():
    news = [NewsItem(title="My talk", summary="", url="https://www.youtube.com/watch?v=1",
                     published_ts=10, feed="YouTube")]
    items = to_follow_items(news, person="Andrej Karpathy", source_label="YouTube")
    assert items[0].primary is True
    assert items[0].publisher == "YouTube"
    assert items[0].kind == "video"


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


async def test_get_person_feed_skips_a_failing_feed():
    import httpx as _httpx

    def handler(req: _httpx.Request) -> _httpx.Response:
        if "news.google.com" in str(req.url):
            return _httpx.Response(200, text=_GNEWS_XML)
        raise _httpx.ConnectError("boom", request=req)  # the custom feed fails

    adapter = PeopleAdapter()
    adapter._client = _httpx.AsyncClient(transport=_httpx.MockTransport(handler))
    items = await adapter.get_person_feed("Paul Tudor Jones", ["https://broken.example/rss"])
    assert len(items) == 1                       # the news item survived
    assert items[0].kind == "news"


def test_extract_channel_id_from_ytinitialdata():
    html = 'foo <script>var x = {"channelId":"UCabc123DEFghi456jkl789"};</script> bar'
    assert extract_channel_id(html) == "UCabc123DEFghi456jkl789"


def test_extract_channel_id_from_canonical_link():
    html = '<link rel="canonical" href="https://www.youtube.com/channel/UCxyz789abc123def456ghi">'
    assert extract_channel_id(html) == "UCxyz789abc123def456ghi"


def test_extract_channel_id_none_when_absent():
    assert extract_channel_id("<html>no channel here</html>") is None


def test_to_follow_items_kind_override_forces_podcast():
    news = [NewsItem(title="Ep 12: macro", summary="", url="https://feeds.x/ep12",
                     published_ts=1, feed="Show")]
    items = to_follow_items(news, "Paul Tudor Jones", "Macro Show", kind_override="podcast")
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
