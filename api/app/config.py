"""Application settings, loaded from environment / api/.env via pydantic-settings.

Secrets live ONLY here (see CLAUDE.md hard rule #2). The frontend never holds
secrets and never reads this. All fields are optional at this phase so the app
boots without any keys configured; adapters that need a key surface an
"unauthenticated" UI state when theirs is missing.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Omphalos API"

    # CORS is intentionally NOT configured here: the frontend reaches the backend
    # through Next.js rewrites (same-origin), per CLAUDE.md conventions.

    # --- Third-party credentials (added per phase; placeholders for now) ---
    # FRED
    fred_api_key: str | None = None
    # Kraken (private/balances)
    kraken_api_key: str | None = None
    kraken_api_secret: str | None = None
    # IBKR Client Portal Gateway
    ibkr_gateway_base_url: str = "https://localhost:5000/v1/api"


@lru_cache
def get_settings() -> Settings:
    return Settings()
