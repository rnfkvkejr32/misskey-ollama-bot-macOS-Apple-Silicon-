from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _float_env(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return float(value)


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "open-nsfw2-service")
    app_env: str = os.getenv("APP_ENV", "production")
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))
    open_nsfw2_home: Path = Path(os.getenv("OPENNSFW2_HOME", "/models"))
    safe_threshold: float = _float_env("SAFE_THRESHOLD", 0.2)
    nsfw_threshold: float = _float_env("NSFW_THRESHOLD", 0.8)
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "20"))

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


settings = Settings()
