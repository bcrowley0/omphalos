"""Suggested-source catalog: enable/disable of curated, off-by-default feeds."""

import pytest

from app.adapters.base import SourceUnavailable
from app.adapters.rss import _DEFAULT_FEEDS, RssAdapter


def test_catalog_is_well_formed_and_disjoint_from_defaults():
    a = RssAdapter()
    catalog = a.suggested_sources()  # [(name, category, urls), ...]
    assert catalog, "catalog should not be empty"
    names = [name for name, _cat, _urls in catalog]
    assert len(names) == len(set(names)), "source names must be unique"
    for name, category, urls in catalog:
        assert name == name.upper(), "names are stored uppercase"
        assert category, f"{name} needs a category"
        assert urls, f"{name} needs at least one feed URL"
        assert all(u.startswith("http") for u in urls), f"{name} has a non-URL feed"
        assert name not in _DEFAULT_FEEDS, f"{name} duplicates an always-on default"


def test_suggested_source_is_off_until_enabled():
    a = RssAdapter()
    name = a.suggested_sources()[0][0]
    assert name not in a.list_feeds(), "suggested sources must not be registered at startup"


def test_enable_then_disable_registers_and_removes_feeds():
    a = RssAdapter()
    name, _cat, urls = a.suggested_sources()[0]

    a.enable_source(name)
    assert a.list_feeds().get(name) == urls

    a.remove_feed(name)
    assert name not in a.list_feeds()


def test_enable_is_idempotent():
    a = RssAdapter()
    name, _cat, urls = a.suggested_sources()[0]
    a.enable_source(name)
    a.enable_source(name)  # twice
    assert a.list_feeds()[name] == urls  # no duplicate URLs


def test_enable_accepts_case_insensitive_name():
    a = RssAdapter()
    name, _cat, urls = a.suggested_sources()[0]
    a.enable_source(name.lower())
    assert a.list_feeds().get(name) == urls


def test_enable_unknown_source_raises():
    a = RssAdapter()
    with pytest.raises(SourceUnavailable):
        a.enable_source("NOPE-NOT-A-SOURCE")


def test_remove_feed_refuses_to_drop_a_default():
    a = RssAdapter()
    default_name = next(iter(_DEFAULT_FEEDS))
    with pytest.raises(SourceUnavailable):
        a.remove_feed(default_name)
    assert default_name in a.list_feeds(), "default must remain registered"
