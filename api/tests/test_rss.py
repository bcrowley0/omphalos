"""Unit tests for RSS parsing/normalization (pure; no network)."""

from app.adapters.rss import dedupe_sort_news, parse_feed
from app.models import NewsItem

_SAMPLE = """<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Sample</title>
  <item>
    <title>Markets rally on data</title>
    <link>https://example.com/a</link>
    <description>&lt;p&gt;Stocks rose as &lt;b&gt;data&lt;/b&gt; beat.&lt;/p&gt;</description>
    <pubDate>Wed, 05 Jun 2024 12:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Second story</title>
    <link>https://example.com/b</link>
    <description>Teaser two.</description>
  </item>
</channel></rss>"""


def test_parse_feed_normalizes_items():
    items = parse_feed(_SAMPLE, "Sample")
    assert len(items) == 2
    first = items[0]
    assert first.title == "Markets rally on data"
    assert first.url == "https://example.com/a"
    assert first.feed == "Sample"
    # HTML stripped from the teaser
    assert "<" not in first.summary and "Stocks rose" in first.summary
    # pubDate -> epoch ms (UTC). 2024-06-05 12:00:00 UTC = 1717588800 s
    assert first.published_ts == 1717588800 * 1000


def test_parse_feed_handles_missing_date():
    items = parse_feed(_SAMPLE, "Sample")
    assert items[1].published_ts is None


def test_dedupe_sort_news_dedupes_by_url_and_sorts_newest_first():
    def mk(url, ts):
        return NewsItem(title="t", summary="", url=url, published_ts=ts, feed="X")

    out = dedupe_sort_news([mk("a", 100), mk("b", 300), mk("a", 100), mk("c", None)])
    urls = [i.url for i in out]
    assert urls[0] == "b"  # newest first
    assert urls.count("a") == 1  # deduped by url
    assert urls[-1] == "c"  # undated sinks to the end
