from pathlib import Path
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, field_validator

ROOT = Path(__file__).resolve().parents[2]
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore', case_sensitive=False)
    dev_storage: Literal["external","moto"] = "external"
    database_url: str
    vault_key_b64: str
    s3_bucket: str
    s3_endpoint_url: str | None = None
    s3_region: str = 'us-east-1'
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_addressing_style: str = 'path'
    s3_create_bucket: bool = False
    s3_allow_http: bool = False
    s3_disable_expect: bool = False
    frontend_dir: Path = ROOT / 'app/public'
    cors_origins: list[str] = []
    cookie_secure: bool = False
    workers: int = Field(2, ge=1, le=8)
    max_pending_per_user: int = Field(10, ge=1, le=100)
    poll_seconds: float = Field(2.5, gt=0, le=60)
    model_check_timeout: float = Field(10, ge=.05, le=15)
    model_timeout: float = Field(180, gt=0, le=180)
    @field_validator('database_url')
    @classmethod
    def postgres_only(cls, v):
        if not v.startswith(('postgresql://','postgres://')): raise ValueError('数据库须为 PostgreSQL')
        return v
    @field_validator('cors_origins')
    @classmethod
    def no_wildcard(cls, v):
        if any('*' in x or not x.startswith(('http://','https://')) for x in v): raise ValueError('CORS 须为明确的 HTTP(S) Origin')
        return v
