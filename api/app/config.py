"""Application settings, loaded from environment / api/.env via pydantic-settings.

Secrets live ONLY here (see CLAUDE.md hard rule #2). The frontend never holds
secrets and never reads this. All fields are optional at this phase so the app
boots without any keys configured; adapters that need a key surface an
"unauthenticated" UI state when theirs is missing.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Absolute path to api/.env (config.py is at api/app/config.py) so reads and the
# write helper below hit the same file regardless of the process's cwd.
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
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


def update_env_file(updates: dict[str, str]) -> None:
    """Insert/update `KEY=value` lines in api/.env, preserving every other line
    (comments, blank lines, unrelated keys). Only the given keys are written.

    Local-first key entry: keys still land in api/.env (the single source of
    truth); this just writes them there so they don't have to be hand-edited.
    """
    lines = ENV_FILE.read_text().splitlines() if ENV_FILE.exists() else []
    remaining = dict(updates)
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        if "=" in stripped and not stripped.startswith("#"):
            key = stripped.split("=", 1)[0].strip()
            if key in remaining:
                out.append(f"{key}={remaining.pop(key)}")
                continue
        out.append(line)
    out.extend(f"{key}={value}" for key, value in remaining.items())
    ENV_FILE.write_text("\n".join(out) + "\n")
    get_settings.cache_clear()  # so the new values take effect without a restart
