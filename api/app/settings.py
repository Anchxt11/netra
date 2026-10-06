from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://soc:soc@postgres:5432/soc"

    kafka_bootstrap: str = "redpanda:9092"
    topic_enriched: str = "events.enriched"
    topic_alerts: str = "alerts"
    kafka_group_prefix: str = "serving"

    clickhouse_host: str = "clickhouse"
    clickhouse_port: int = 8123
    clickhouse_user: str = "default"
    clickhouse_password: str = ""
    clickhouse_db: str = "default"
    clickhouse_table: str = "events_enriched"

    jwt_secret: str = "dev-secret-change-me-please-0123456789"
    jwt_alg: str = "HS256"
    jwt_ttl_minutes: int = 60

    admin_username: str = "admin"
    admin_password: str = "admin12345"
    analyst_username: str = "analyst"
    analyst_password: str = "analyst12345"

    cors_origins: str = "*"            # comma separated
    ws_flush_ms: int = 250             # event batching interval
    ws_max_events_per_push: int = 200  # cap per push; extras are counted in `dropped`


settings = Settings()
