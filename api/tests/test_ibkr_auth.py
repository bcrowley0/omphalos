"""Tests for the IBKR connection-status helper, adapter method, and endpoint."""

import httpx
import pytest

from app.adapters.ibkr import IbkrAdapter, gateway_login_url


def test_gateway_login_url_strips_v1_api_path():
    assert gateway_login_url("https://localhost:5000/v1/api") == "https://localhost:5000"


def test_gateway_login_url_preserves_host_and_port():
    assert gateway_login_url("https://127.0.0.1:5001/v1/api") == "https://127.0.0.1:5001"


def test_gateway_login_url_tolerates_trailing_slash():
    assert gateway_login_url("https://localhost:5000/v1/api/") == "https://localhost:5000"
