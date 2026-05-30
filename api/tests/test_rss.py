"""Unit tests for RSS parsing/normalization (pure; no network)."""

from app.adapters.rss import parse_feed

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
