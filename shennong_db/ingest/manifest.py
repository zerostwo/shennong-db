from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from shennong_db.schemas.datasets import DatasetVersionCreate


class IngestionManifest(BaseModel):
    dataset: DatasetVersionCreate
    source_uri: str | None = None
    table: str | None = None
    format: str = Field(default="csv", pattern="^(csv|parquet|soma|xena)$")
    options: dict[str, Any] = Field(default_factory=dict)


def load_manifest(path: Path) -> IngestionManifest:
    raw = path.read_text(encoding="utf-8")
    if path.suffix.lower() in {".yaml", ".yml"}:
        try:
            import yaml
        except ImportError as exc:
            raise RuntimeError("YAML manifests require PyYAML; use JSON or install PyYAML") from exc
        data = yaml.safe_load(raw)
        return IngestionManifest.model_validate(data)
    return IngestionManifest.model_validate_json(raw)
