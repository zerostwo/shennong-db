from __future__ import annotations

from pathlib import Path

from shennong_db.schemas.datasets import AssetKind, DatasetAssetCreate

DATA_PROFILES = {
    "bulk": {
        "required": ["matrix"],
        "optional": ["phenotype", "gene_map", "sample_metadata"],
        "formats": ["tsv", "csv", "parquet"],
    },
    "single_cell": {
        "required": ["matrix"],
        "optional": ["obs", "var", "embedding.*", "cell_metadata"],
        "formats": ["10x_h5", "h5ad", "soma", "parquet", "tsv"],
    },
    "spatial": {
        "required": ["matrix"],
        "optional": ["obs", "var", "embedding.spatial", "image.*", "coordinates"],
        "formats": ["h5ad", "soma", "10x_h5", "parquet", "tiff"],
    },
    "reference": {
        "required": ["reference.fasta"],
        "optional": ["annotation.gtf", "index.fai", "index.dict", "index.bwa.*", "index.star.*"],
        "formats": ["fasta", "gtf", "gff", "fai", "dict", "binary"],
    },
    "resource": {
        "required": ["data"],
        "optional": ["metadata", "index.*", "documentation"],
        "formats": ["feather", "parquet", "sqlite", "csv", "tsv", "json", "archive"],
    },
    "table": {
        "required": ["table"],
        "optional": ["schema", "index.*", "metadata"],
        "formats": ["feather", "parquet", "csv", "tsv", "sqlite"],
    },
}


def infer_asset(role: str, path: Path, *, derived_from: str | None = None) -> DatasetAssetCreate:
    name = path.name.lower()
    compression = "gzip" if name.endswith((".gz", ".bgz")) else None
    uncompressed = name.removesuffix(".gz").removesuffix(".bgz")
    suffix = Path(uncompressed).suffix.lower()
    format_by_suffix = {
        ".fa": "fasta",
        ".fasta": "fasta",
        ".fna": "fasta",
        ".gtf": "gtf",
        ".gff": "gff",
        ".gff3": "gff",
        ".fai": "fai",
        ".dict": "dict",
        ".h5": "10x_h5",
        ".h5ad": "h5ad",
        ".feather": "feather",
        ".parquet": "parquet",
        ".db": "sqlite",
        ".sqlite": "sqlite",
        ".sqlite3": "sqlite",
        ".csv": "csv",
        ".tsv": "tsv",
        ".txt": "tsv",
        ".json": "json",
        ".zip": "archive",
        ".tar": "archive",
    }
    format_name = format_by_suffix.get(suffix, suffix.lstrip(".") or "binary")
    normalized = role.lower()
    if normalized.startswith("embedding"):
        kind = AssetKind.embedding
    elif normalized.startswith("index"):
        kind = AssetKind.index
    elif normalized.startswith(("reference", "genome")):
        kind = AssetKind.reference
    elif normalized.startswith(("annotation", "gene_map")):
        kind = AssetKind.annotation
    elif normalized in {"matrix", "expression", "counts", "soma", "h5", "h5ad"}:
        kind = AssetKind.matrix
    elif normalized in {"obs", "var", "metadata", "phenotype", "cell_metadata"}:
        kind = AssetKind.metadata
    elif format_name == "sqlite":
        kind = AssetKind.database
    elif format_name in {"csv", "tsv", "parquet", "feather"}:
        kind = AssetKind.table
    elif format_name == "archive":
        kind = AssetKind.archive
    else:
        kind = AssetKind.other
    return DatasetAssetCreate(
        role=role,
        kind=kind,
        format=format_name,
        storage_uri=str(path),
        compression=compression,
        size_bytes=path.stat().st_size if path.exists() and path.is_file() else None,
        derived_from=derived_from,
    )
