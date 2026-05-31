"""Unit tests for RSS parsing/normalization (pure; no network)."""

from app.adapters.rss import dedupe_sort_news, interleave_by_source, parse_feed
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


# A bridged X (Nitter) item: description duplicates the title, link points at the
# Nitter instance with a trailing #m anchor.
_TWEET = """<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>@acct</title>
  <item>
    <title>BREAKING: thing happened</title>
    <link>https://nitter.net/acct/status/123#m</link>
    <description>&lt;p&gt;BREAKING: thing happened&lt;/p&gt;</description>
    <pubDate>Wed, 05 Jun 2024 12:00:00 GMT</pubDate>
  </item>
</channel></rss>"""


def test_parse_feed_drops_summary_that_duplicates_title():
    # Tweets carry the same text as title and body; don't render it twice.
    items = parse_feed(_TWEET, "DEITAONE")
    assert items[0].title == "BREAKING: thing happened"
    assert items[0].summary == ""


def test_parse_feed_rewrites_nitter_link_to_x_com():
    items = parse_feed(_TWEET, "DEITAONE")
    # Bridge permalink -> canonical x.com, trailing #m anchor stripped.
    assert items[0].url == "https://x.com/acct/status/123"


def test_interleave_caps_firehose_and_includes_every_source():
    def mk(src, url, ts):
        return NewsItem(title="t", summary="", url=url, published_ts=ts, feed=src)

    items = [mk("FIRE", f"f{i}", 1000 + i) for i in range(20)]  # high-frequency
    items += [mk("ECON", "e1", 500), mk("ECON", "e2", 400)]  # low-frequency, older
    items += [mk("WIRE", "w1", 900)]

    out = interleave_by_source(items, 6)
    assert len(out) == 6
    srcs = {i.feed for i in out}
    assert {"FIRE", "ECON", "WIRE"} <= srcs  # every source represented
    assert sum(1 for i in out if i.feed == "FIRE") < 6  # firehose can't hog the view
    assert out[0].feed == "FIRE"  # freshest source still leads


def test_interleave_single_source_is_pure_recency():
    def mk(url, ts):
        return NewsItem(title="t", summary="", url=url, published_ts=ts, feed="FT")

    out = interleave_by_source([mk("a", 100), mk("b", 300), mk("a", 100), mk("c", None)], 60)
    urls = [i.url for i in out]
    assert urls == ["b", "a", "c"]  # deduped, newest-first, undated last
