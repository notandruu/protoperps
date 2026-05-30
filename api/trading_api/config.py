from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    kafka_brokers: str = "localhost:9092"
    redis_url: str = "redis://localhost:6379"
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/trading"

    class Config:
        env_prefix = ""
        env_file = ".env"


settings = Settings()
