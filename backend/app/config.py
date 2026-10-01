from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://team:team@localhost:5432/team"
    # Empty REDIS_URL -> in-process store (single-process dev/tests only).
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "change-me"
    jwt_ttl_hours: int = 24
    # Seconds without heartbeat before an agent is considered OFFLINE.
    heartbeat_timeout: int = 30
    # What each person may spend on Claude per week (estimated SDK cost); drives the "Claude semana %" meter.
    weekly_budget_usd: float = 20.0
    owner_password: str = "owner-change-me"
    mark_password: str = "mark-change-me"
    david_password: str = "david-change-me"
    frontend_dir: str = str(Path(__file__).resolve().parents[2] / "frontend")
    library_dir: str = str(Path(__file__).resolve().parents[2] / "library")


settings = Settings()
