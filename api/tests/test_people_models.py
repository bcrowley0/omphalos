from app.models import FollowItem, PeopleFeedResponse, PersonAnchors, PersonRef, SourceStatus


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
