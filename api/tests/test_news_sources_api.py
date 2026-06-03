"""Router tests for the suggested-source catalog + enable/disable endpoints."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_catalog_lists_suggested_sources_with_categories():
    r = client.get("/news/catalog")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["sources"], "catalog should not be empty"
    s = body["sources"][0]
    assert {"name", "category", "urls"} <= s.keys()
    assert s["urls"]


def test_enable_then_disable_source_roundtrips_via_api():
    name = client.get("/news/catalog").json()["sources"][0]["name"]

    enabled = client.post("/news/sources/enable", json={"name": name})
    assert enabled.status_code == 200
    assert enabled.json()["status"] == "ok"
    assert name in {f["name"] for f in enabled.json()["feeds"]}

    disabled = client.post("/news/sources/disable", json={"name": name})
    assert disabled.status_code == 200
    assert name not in {f["name"] for f in disabled.json()["feeds"]}


def test_disable_default_source_is_rejected_and_keeps_it():
    # FT is an always-on default; disabling it must not drop it.
    r = client.post("/news/sources/disable", json={"name": "FT"})
    assert r.json()["status"] != "ok"
    assert "FT" in {f["name"] for f in client.get("/news/feeds").json()["feeds"]}
