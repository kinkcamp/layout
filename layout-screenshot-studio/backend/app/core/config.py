from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LSS_", env_file=None, extra="ignore")

    app_name: str = "Layout Screenshot Studio"
    environment: Literal["development", "test", "production"] = "development"
    database_url: str = f"sqlite:///{PROJECT_ROOT / 'data' / 'layout_studio.db'}"
    data_dir: Path = PROJECT_ROOT / "data"
    jwt_secret: str = "local-development-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    admin_username: str = "admin"
    admin_password: str = "admin123"
    demo_project_name: str = "Demo Project"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    task_backend: Literal["local", "celery"] = "local"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"
    max_upload_bytes: int = 5 * 1024**3
    max_upload_chunks: int = 10000
    max_concurrent_uploads: int = 5
    user_storage_quota_bytes: int = 20 * 1024**3
    min_free_disk_bytes: int = 256 * 1024**2
    max_screenshot_pixels: int = 100_000_000
    max_screenshot_side: int = 16384
    max_running_tasks_per_user: int = 2
    query_scan_limit: int = 100_000
    render_max_shapes: int = 250_000
    layout_cache_entries: int = Field(default=4, ge=1, le=16)
    tile_schema_version: str = "tile-v1"

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def upload_sessions_dir(self) -> Path:
        return self.data_dir / "uploads" / "sessions"

    @property
    def originals_dir(self) -> Path:
        return self.data_dir / "uploads" / "originals"

    @property
    def tiles_dir(self) -> Path:
        return self.data_dir / "cache" / "tiles"

    @property
    def metadata_dir(self) -> Path:
        return self.data_dir / "cache" / "metadata"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports" / "screenshots"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    def ensure_directories(self) -> None:
        for path in (
            self.data_dir,
            self.upload_sessions_dir,
            self.originals_dir,
            self.tiles_dir,
            self.metadata_dir,
            self.exports_dir,
            self.logs_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)

    @model_validator(mode="after")
    def validate_limits(self) -> "Settings":
        if self.environment == "production" and self.jwt_secret == "local-development-secret-change-me":
            raise ValueError("LSS_JWT_SECRET must be set in production")
        if self.max_screenshot_pixels <= 0 or self.max_screenshot_side <= 0:
            raise ValueError("screenshot limits must be positive")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
