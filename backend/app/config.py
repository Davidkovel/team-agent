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
    # True: no hierarchy - every signed-in person sees and can do everything. False: only role=owner can.
    team_mode: bool = True
    # Networks (comma-separated CIDRs, e.g. the Radmin VPN "26.0.0.0/8") whose widgets may use /api/local/* like this computer.
    widget_networks: str = ""
    # Optional: lets the commit feed read private GitHub repos (a token with read access to contents).
    github_token: str = ""
    # Shared key that lets the widgets of other computers (over Radmin/LAN) show who is online. Empty = this computer only.
    team_key: str = ""
    # Sign-in by computer, no password: "ip=login,ip=login". The server computer itself is 127.0.0.1.
    ip_users: str = "127.0.0.1=mark,::1=mark"
    # The team's Radmin VPN IPs (see CLAUDE.md), always signed in by computer. IP_USERS adds to these or overrides one.
    # Until 3 Oct David's IP lived only in the host's backend/.env and was missing there, so his browser got the password page.
    team_ip_users: str = "26.68.80.191=owner,26.244.76.112=mark,26.245.177.206=david"
    # Hub-to-Hub sync (sync.py): every computer runs its own Hub and they trade changes; there is no host. The widget sets SYNC=1.
    sync: bool = False
    sync_seconds: int = 5
    sync_port: int = 8000
    # For a test or an odd network: this computer's number (0 = the owner's) and the other Hubs as "host:port,host:port".
    sync_node: int = -1
    sync_peers: str = ""
    owner_password: str = "owner-change-me"
    mark_password: str = "mark-change-me"
    david_password: str = "david-change-me"
    frontend_dir: str = str(Path(__file__).resolve().parents[2] / "frontend")
    library_dir: str = str(Path(__file__).resolve().parents[2] / "library")


settings = Settings()
