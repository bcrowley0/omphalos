from app.config import Settings, resolve_ibkr_auth_mode


def _oauth_settings(**over):
    base = dict(
        ibkr_oauth_consumer_key="CONSUMER",
        ibkr_oauth_access_token="TOKEN",
        ibkr_oauth_access_token_secret="SECRET",
        ibkr_oauth_signature_key_path="/keys/sig.pem",
        ibkr_oauth_encryption_key_path="/keys/enc.pem",
        ibkr_oauth_dh_prime="ABCDEF",
    )
    base.update(over)
    return Settings(_env_file=None, **base)


def test_oauth_configured_true_when_all_present():
    assert _oauth_settings().ibkr_oauth_configured is True


def test_oauth_configured_false_when_any_missing():
    # representative: any single missing field is sufficient to be unconfigured
    assert _oauth_settings(ibkr_oauth_dh_prime=None).ibkr_oauth_configured is False


def test_mode_defaults_to_oauth_when_configured():
    assert resolve_ibkr_auth_mode(_oauth_settings()) == "oauth"


def test_mode_defaults_to_gateway_when_not_configured():
    s = Settings(_env_file=None)
    assert resolve_ibkr_auth_mode(s) == "gateway"


def test_explicit_mode_overrides_default():
    s = _oauth_settings(ibkr_auth_mode="gateway")
    assert resolve_ibkr_auth_mode(s) == "gateway"
