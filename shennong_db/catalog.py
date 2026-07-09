from __future__ import annotations

from typing import Any

from shennong_db.schemas.common import DatasetType
from shennong_db.schemas.datasets import DatasetVersion
from shennong_db.schemas.semantic import CatalogDatasetDetail, CatalogDatasetSummary, DataModel


def dataset_data_model(dataset: DatasetVersion) -> DataModel:
    explicit = dataset.metadata.get("data_model")
    if explicit:
        return DataModel(explicit)
    mapping = {
        DatasetType.bulk_expression: DataModel.bulk,
        DatasetType.survival: DataModel.clinical,
        DatasetType.single_cell: DataModel.single_cell,
        DatasetType.spatial: DataModel.spatial,
        DatasetType.eqtl: DataModel.qtl,
    }
    return mapping[dataset.type]


def dataset_assays(dataset: DatasetVersion) -> list[str]:
    explicit = dataset.metadata.get("assays")
    if isinstance(explicit, list) and explicit:
        return [str(item) for item in explicit]
    mapping = {
        DatasetType.bulk_expression: ["rna"],
        DatasetType.survival: ["clinical", "survival"],
        DatasetType.single_cell: ["rna"],
        DatasetType.spatial: ["spatial_rna"],
        DatasetType.eqtl: ["eqtl"],
    }
    return mapping[dataset.type]


def dataset_title(dataset: DatasetVersion) -> str:
    return str(dataset.metadata.get("title") or dataset.dataset_id.replace("_", " ").title())


def dataset_visibility(dataset: DatasetVersion) -> str:
    return str(dataset.metadata.get("visibility") or "public")


def summarize_dataset(dataset: DatasetVersion) -> CatalogDatasetSummary:
    return CatalogDatasetSummary(
        dataset=dataset.dataset_id,
        title=dataset_title(dataset),
        data_model=dataset_data_model(dataset),
        assays=dataset_assays(dataset),
        default_version=dataset.version,
        backend=dataset.backend,
        visibility=dataset_visibility(dataset),
    )


def detail_dataset(dataset: DatasetVersion, versions: list[DatasetVersion]) -> CatalogDatasetDetail:
    summary = summarize_dataset(dataset)
    source = dataset.metadata.get("source")
    return CatalogDatasetDetail(
        **summary.model_dump(),
        description=dataset.metadata.get("description"),
        versions=sorted(
            {item.version for item in versions if item.dataset_id == dataset.dataset_id}
        ),
        citation=dataset.citation,
        license=dataset.metadata.get("license"),
        status=dataset.status.value,
        publication_state=str(dataset.metadata.get("publication_state") or dataset.status.value),
        source_roles=sorted(source) if isinstance(source, dict) else [],
        created_at=dataset.created_at,
        updated_at=dataset.updated_at,
    )


def semantic_schema(dataset: DatasetVersion) -> dict[str, Any]:
    custom = dataset.metadata.get("schema")
    if isinstance(custom, dict):
        return custom

    common = {
        "dataset": dataset.dataset_id,
        "version": dataset.version,
        "data_model": dataset_data_model(dataset),
        "assays": dataset_assays(dataset),
        "return_formats": ["json"],
    }
    if dataset.type == DatasetType.bulk_expression:
        return {
            **common,
            "observation": {
                "type": "sample",
                "id_field": "sample_id",
                "fields": {
                    "sample_id": "string",
                    "cancer": "categorical",
                    "group": "categorical",
                    "group_name": "categorical",
                },
            },
            "feature": {
                "type": "gene",
                "id_fields": ["gene_symbol"],
                "fields": {"gene_symbol": "string"},
            },
            "layers": [dataset.metadata.get("layer") or "log2_tpm"],
            "measures": ["expression"],
            "return_shapes": ["tidy", "table"],
        }
    if dataset.type == DatasetType.survival:
        return {
            **common,
            "observation": {
                "type": "sample",
                "id_field": "sample_id",
                "fields": {
                    "sample_id": "string",
                    "cancer": "categorical",
                    "time": "numeric",
                    "event": "integer",
                },
            },
            "feature": {"type": "clinical_endpoint", "id_fields": ["endpoint"]},
            "layers": [],
            "measures": ["survival_time", "event"],
            "return_shapes": ["table"],
        }
    if dataset.type == DatasetType.eqtl:
        return {
            **common,
            "observation": {
                "type": "variant_gene_tissue_record",
                "id_field": "variant_id",
                "fields": {
                    "variant_id": "string",
                    "tissue": "categorical",
                    "phenotype": "categorical",
                },
            },
            "feature": {"type": "gene_variant", "id_fields": ["gene_symbol", "variant_id"]},
            "layers": [],
            "measures": ["beta", "se", "pvalue", "qvalue"],
            "return_shapes": ["table"],
        }
    if dataset.type == DatasetType.spatial:
        observation_type = "spot"
        id_field = "cell_id"
        fields = {"cell_id": "string", "x": "numeric", "y": "numeric"}
    else:
        observation_type = "cell"
        id_field = "cell_id"
        fields = {"cell_id": "string", "sample_id": "string", "cell_type": "categorical"}
    return {
        **common,
        "observation": {"type": observation_type, "id_field": id_field, "fields": fields},
        "feature": {"type": "gene", "id_fields": ["gene_id", "gene_symbol"]},
        "layers": ["counts", "lognorm", "scaled"],
        "embeddings": ["X_umap", "X_pca"],
        "measures": ["expression"],
        "return_shapes": ["tidy", "matrix", "matrix_with_obs"],
    }


def capabilities(dataset: DatasetVersion) -> dict[str, Any]:
    custom = dataset.metadata.get("capabilities")
    if isinstance(custom, dict):
        return custom
    base = {
        "dataset": dataset.dataset_id,
        "can_filter_observations": True,
        "can_filter_features": dataset.type
        in {
            DatasetType.bulk_expression,
            DatasetType.single_cell,
            DatasetType.spatial,
            DatasetType.eqtl,
        },
        "can_query_matrix": dataset.type
        in {DatasetType.bulk_expression, DatasetType.single_cell, DatasetType.spatial},
        "can_compute_pseudobulk": dataset.type in {DatasetType.single_cell, DatasetType.spatial},
        "can_compute_de": dataset.type in {DatasetType.single_cell, DatasetType.spatial},
        "can_compute_signature_score": dataset.type
        in {DatasetType.bulk_expression, DatasetType.single_cell, DatasetType.spatial},
        "can_query_embedding": dataset.type in {DatasetType.single_cell, DatasetType.spatial},
        "can_export_seurat": dataset.type in {DatasetType.single_cell, DatasetType.spatial},
        "can_export_h5ad": dataset.type in {DatasetType.single_cell, DatasetType.spatial},
        "max_sync_cells": 100_000,
        "max_sync_features": 200,
        "async_required_above_cells": 100_000,
    }
    return base


def fields(dataset: DatasetVersion) -> list[dict[str, str]]:
    schema = semantic_schema(dataset)
    values: list[dict[str, str]] = []
    for scope in ("observation", "feature"):
        section = schema.get(scope, {})
        for name, field_type in section.get("fields", {}).items():
            values.append({"field": name, "type": str(field_type), "scope": scope})
    return values
