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
