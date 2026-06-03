"""Unit tests for the SDR (CFTC swap data repository) adapter — pure functions
plus the fetch/unzip shell (monkeypatched, no network)."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.models import SwapCurve, SwapTenorPoint, SwapsResponse, SourceStatus


def test_models_camel_case_on_the_wire():
    point = SwapTenorPoint(
        tenor_label="10Y", tenor_years=10.0, rate_pct=3.98, trade_count=2, total_notional=75_000_000.0
    )
    dumped = point.model_dump(by_alias=True)
    assert dumped["tenorLabel"] == "10Y"
    assert dumped["totalNotional"] == 75_000_000.0

    curve = SwapCurve(key="sofr", label="SOFR OIS", obs_date=1_700_000_000_000, points=[point])
    resp = SwapsResponse(status=SourceStatus.OK, file_date=1_700_000_000_000, curves=[curve])
    body = resp.model_dump(by_alias=True)
    assert body["fileDate"] == 1_700_000_000_000
    assert body["curves"][0]["key"] == "sofr"
    assert body["curves"][0]["points"][0]["tenorLabel"] == "10Y"
