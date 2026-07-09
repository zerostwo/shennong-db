from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from SHENNONG_* environment variables."""

    app_name: str = "Shennong Data Server"
    app_version: str = "0.1.0"
    api_prefix: str = "/v1"
    environment: Literal["local", "test", "staging", "production"] = "local"
    cors_origins: list[AnyHttpUrl] | list[str] = Field(default_factory=list)
    docs_enabled: bool = False
    admin_api_key: str | None = None

    registry_backend: Literal["postgres", "memory"] = "postgres"
    metadata_url: str = "postgresql+asyncpg://shennong:shennong@localhost:5432/shennong_metadata"

    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8123
    clickhouse_username: str = "default"
    clickhouse_password: str = ""
    clickhouse_database: str = "shennong"
    clickhouse_secure: bool = False

    redis_url: str | None = "redis://localhost:6379/0"
    query_cache_ttl_seconds: int = 300
    expression_gene_cache_ttl_seconds: int = 900
    cached_gene_target_ms: int = 300
    auto_create_metadata_schema: bool = True

    default_page_size: int = 1000
    max_page_size: int = 10000
    disable_external_backends: bool = False
    max_upload_bytes: int = 512 * 1024 * 1024

    clickhouse_expression_table: str = "expression_bulk"
    clickhouse_survival_table: str = "survival_events"
    clickhouse_eqtl_table: str = "eqtl_summary"

    tiledb_context: str | None = None
    local_data_root: str = "/data/shennong"

    model_config = SettingsConfigDict(
        env_prefix="SHENNONG_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
