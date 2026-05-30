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
