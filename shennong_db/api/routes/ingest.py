from __future__ import annotations

import asyncio
import csv
import gzip
import json
import re
import shutil
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from shennong_db.api.deps import get_registry, get_settings
from shennong_db.config import Settings
from shennong_db.errors import ValidationError
from shennong_db.formats import infer_asset
from shennong_db.ingest.loaders import build_xena_matrix_index
from shennong_db.jobs import InMemoryJobStore
from shennong_db.registry.service import DatasetRegistryService
from shennong_db.schemas.common import DatasetType
from shennong_db.schemas.datasets import DatasetAssetCreate, DatasetVersionCreate
from shennong_db.schemas.ingest import (
    IngestRequest,
    IngestResponse,
    IngestValidationIssue,
    IngestValidationReport,
    UploadPreview,
)
from shennong_db.schemas.semantic import APIStatus, JobCreate, JobResponse
from shennong_db.security import require_admin, validate_dataset_storage

router = APIRouter(prefix="/ingest", tags=["ingest"], dependencies=[Depends(require_admin)])

_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_SOURCE_ROLES_BY_MODEL: dict[str, set[str]] = {
    "bulk": {"expression", "matrix", "phenotype", "metadata", "file", "upload"},
    "clinical": {"clinical", "survival", "events", "metadata", "file", "upload"},
    "qtl": {"eqtl", "qtl", "variants", "metadata", "file", "upload"},
    "single_cell": {"soma", "h5", "h5ad", "matrix", "metadata", "file", "upload"},
    "spatial": {"soma", "h5", "h5ad", "spatial", "metadata", "file", "upload"},
    "table": {"table", "schema", "metadata", "file", "upload"},
    "reference": {"reference", "genome", "annotation", "index", "file", "upload"},
    "resource": {"data", "database", "metadata", "index", "file", "upload"},
}
_QUERY_BACKENDS_BY_MODEL: dict[str, set[str]] = {
    "bulk": {"clickhouse", "xena", "memory"},
    "clinical": {"clickhouse", "memory"},
    "qtl": {"clickhouse", "memory"},
    "single_cell": {"tiledb_soma", "tenx_h5", "memory"},
    "spatial": {"tiledb_soma", "tenx_h5", "memory"},
}
_TABULAR_SOURCE_ROLES = {
    "expression",
    "matrix",
    "clinical",
    "survival",
    "events",
    "eqtl",
    "qtl",
    "variants",
    "table",
    "file",
    "upload",
}
_OBJECT_SOURCE_ROLES = {"soma", "h5", "h5ad", "spatial"}
_GENE_COLUMNS = {"gene", "gene_id", "gene_symbol", "genesymbol", "feature", "feature_id"}
_SAMPLE_COLUMNS = {"sample", "sample_id", "sampleid", "observation_id"}
_VALUE_COLUMNS = {"value", "expression", "expr", "tpm", "log2_tpm", "counts", "count"}
_TIME_COLUMNS = {"time", "survival_time", "os_time", "days", "days_to_death"}
_EVENT_COLUMNS = {"event", "status", "os_event", "vital_status", "death_event"}
_VARIANT_COLUMNS = {"variant", "variant_id", "snp", "rsid"}
_PVALUE_COLUMNS = {"pvalue", "p_value", "pval", "p"}


def _dataset_type_for_model(payload: IngestRequest) -> DatasetType:
    if payload.dataset_type is not None:
        return payload.dataset_type
    mapping = {
        "bulk": DatasetType.bulk_expression,
        "single_cell": DatasetType.single_cell,
        "spatial": DatasetType.spatial,
        "clinical": DatasetType.survival,
        "qtl": DatasetType.eqtl,
        "table": DatasetType.table,
        "reference": DatasetType.reference,
        "resource": DatasetType.resource,
    }
    dataset_type = mapping.get(payload.data_model.value)
    if dataset_type is None:
        raise ValidationError(
            f"Ingestion for data_model '{payload.data_model}' is not supported yet",
            details={"data_model": payload.data_model},
        )
    return dataset_type


def _default_storage_uri(payload: IngestRequest) -> str | None:
    if payload.storage_uri:
        return payload.storage_uri
    for key in (
        "expression",
        "matrix",
        "clinical",
        "survival",
        "events",
        "eqtl",
        "qtl",
        "variants",
        "soma",
        "h5",
        "h5ad",
        "spatial",
        "metadata",
        "table",
        "file",
        "upload",
    ):
        if key in payload.source:
            return payload.source[key]
    return None


def _json_form_object(value: str | None, field: str) -> dict:
    if value is None or value == "":
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"`{field}` must be a JSON object", details={"field": field}) from exc
    if not isinstance(parsed, dict):
        raise ValidationError(f"`{field}` must be a JSON object", details={"field": field})
    return parsed


def _validated_identifier(value: str, field: str) -> str:
    if not _IDENTIFIER_RE.match(value):
        raise ValidationError(
            f"`{field}` must contain only letters, numbers, dots, dashes, and underscores",
            details={"field": field, "value": value},
        )
    return value


def _safe_filename(filename: str | None) -> str:
    name = Path(filename or "").name
    if name in {"", ".", ".."}:
        raise ValidationError("Uploaded file must have a valid filename")
    return name


def _upload_target(settings: Settings, dataset: str, version: str, filename: str) -> Path:
    dataset = _validated_identifier(dataset, "dataset")
    version = _validated_identifier(version, "version")
    root = Path(settings.local_data_root).resolve()
    target_dir = (root / "uploads" / dataset / version).resolve()
    if not target_dir.is_relative_to(root):
        raise ValidationError("Upload target escapes the configured data root")
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ValidationError("Upload target is not writable.") from exc
    return target_dir / filename


async def _save_upload(file: UploadFile, target: Path, *, max_bytes: int) -> int:
    size = 0
    try:
        with target.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise ValidationError(
                        "Uploaded file exceeds SHENNONG_MAX_UPLOAD_BYTES",
                        details={"max_upload_bytes": max_bytes},
                    )
                handle.write(chunk)
    except ValidationError:
        target.unlink(missing_ok=True)
        raise
    except OSError as exc:
        target.unlink(missing_ok=True)
        raise ValidationError("Upload target is not writable.") from exc
    return size


def _preview_upload(
    path: Path,
    *,
    filename: str,
    content_type: str | None,
    size_bytes: int,
    max_rows: int = 5,
) -> UploadPreview:
    warnings: list[str] = []
    opener = gzip.open if path.name.lower().endswith((".gz", ".bgz")) else Path.open
    try:
        with opener(
            path, "rt" if opener is gzip.open else "r", encoding="utf-8-sig", newline=""
        ) as handle:
            sample = handle.read(64 * 1024)
    except (OSError, UnicodeDecodeError):
        try:
            with opener(
                path, "rt" if opener is gzip.open else "r", encoding="latin-1", newline=""
            ) as handle:
                sample = handle.read(64 * 1024)
            warnings.append("Preview decoded with latin-1 fallback.")
        except (OSError, UnicodeDecodeError):
            return UploadPreview(
                filename=filename,
                content_type=content_type,
                size_bytes=size_bytes,
                warnings=["Uploaded file is not text-previewable."],
            )
    if not sample.strip():
        return UploadPreview(
            filename=filename,
            content_type=content_type,
            size_bytes=size_bytes,
            warnings=["Uploaded file is empty."],
        )

    delimiter = "\t" if "\t" in sample.splitlines()[0] else ","
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
        delimiter = dialect.delimiter
    except csv.Error:
        warnings.append("Could not infer delimiter confidently; using a filename/header heuristic.")

    rows: list[dict[str, Any]] = []
    try:
        reader = csv.DictReader(sample.splitlines(), delimiter=delimiter)
        columns = [str(column) for column in (reader.fieldnames or [])]
        for row in reader:
            if len(rows) >= max_rows:
                break
            rows.append({str(key): value for key, value in row.items() if key is not None})
        truncated = next(reader, None) is not None
    except csv.Error as exc:
        return UploadPreview(
            filename=filename,
            content_type=content_type,
            size_bytes=size_bytes,
            delimiter=delimiter,
            warnings=[f"Could not parse tabular preview: {exc}"],
        )
    return UploadPreview(
        filename=filename,
        content_type=content_type,
        size_bytes=size_bytes,
        delimiter=delimiter,
        columns=columns,
        sample_rows=rows,
        sampled_rows=len(rows),
        truncated=truncated,
        warnings=warnings,
    )


def _dataset_create_from_ingest(payload: IngestRequest) -> DatasetVersionCreate:
    metadata = dict(payload.metadata)
    metadata.setdefault("data_model", payload.data_model.value)
    metadata.setdefault("source", payload.source)
    metadata.setdefault("options", payload.options)
    return DatasetVersionCreate(
        dataset_id=payload.dataset,
        type=_dataset_type_for_model(payload),
        backend=payload.backend,
        version=payload.version,
        citation=payload.citation,
        storage_uri=_default_storage_uri(payload),
        status=payload.status,
        is_default=payload.is_default,
        schema_version=payload.schema_version,
        visibility=payload.visibility,
        metadata=metadata,
    )


def _issue(
    level: Literal["error", "warning", "info"],
    field: str,
    message: str,
    *,
    details: dict[str, Any] | None = None,
) -> IngestValidationIssue:
    return IngestValidationIssue(
        level=level,
        field=field,
        message=message,
        details=details or {},
    )


def _path_from_uri(value: str) -> Path | None:
    parsed = urlparse(value)
    if parsed.scheme == "file":
        return Path(parsed.path)
    if parsed.scheme:
        return None
    path = Path(value)
    return path if path.is_absolute() else None


def _append_path_warnings(
    issues: list[IngestValidationIssue],
    *,
    field: str,
    value: str | None,
) -> None:
    if not value:
        return
    path = _path_from_uri(value)
    if path is None:
        return
    if not path.exists():
        issues.append(
            _issue(
                "warning",
                field,
                "Storage path is inside the allowed namespace but does not exist yet.",
                details={"storage_uri": value},
            )
        )


def _source_role_for_validation(payload: IngestRequest) -> str | None:
    preferred = (
        "expression",
        "matrix",
        "clinical",
        "survival",
        "events",
        "eqtl",
        "qtl",
        "variants",
        "soma",
        "h5",
        "h5ad",
        "spatial",
        "table",
        "file",
        "upload",
    )
    for role in preferred:
        if role in payload.source:
            return role
    return next(iter(payload.source), None)


def _preview_source_uri(storage_uri: str | None, source_role: str | None) -> UploadPreview | None:
    if not storage_uri or source_role not in _TABULAR_SOURCE_ROLES:
        return None
    path = _path_from_uri(storage_uri)
    if path is None or not path.exists() or not path.is_file():
        return None
    return _preview_upload(
        path,
        filename=path.name,
        content_type=None,
        size_bytes=path.stat().st_size,
    )


def _normalized_column(value: str) -> str:
    return value.strip().lower().replace(" ", "_").replace("-", "_").replace(".", "_")


def _normalized_columns(preview: UploadPreview) -> set[str]:
    return {_normalized_column(column) for column in preview.columns}


def _has_any(columns: set[str], candidates: set[str]) -> bool:
    return bool(columns & candidates)


def _missing_column_groups(
    columns: set[str],
    groups: dict[str, set[str]],
) -> list[str]:
    return [name for name, candidates in groups.items() if not _has_any(columns, candidates)]


def _append_missing_columns_issue(
    issues: list[IngestValidationIssue],
    *,
    data_model: str,
    field: str,
    missing: list[str],
    expected: dict[str, set[str]],
    columns: list[str],
) -> None:
    if missing:
        issues.append(
            _issue(
                "error",
                field,
                "Preview columns do not satisfy the expected schema for this data model.",
                details={
                    "data_model": data_model,
                    "missing": missing,
                    "expected_any_of": {key: sorted(value) for key, value in expected.items()},
                    "columns": columns,
                },
            )
        )


def _validate_bulk_preview(
    issues: list[IngestValidationIssue],
    *,
    backend: str,
    source_role: str | None,
    preview: UploadPreview,
) -> None:
    columns = _normalized_columns(preview)
    first_column = _normalized_column(preview.columns[0]) if preview.columns else ""
    long_groups = {
        "sample": _SAMPLE_COLUMNS,
        "gene": _GENE_COLUMNS,
        "value": _VALUE_COLUMNS,
    }
    long_missing = _missing_column_groups(columns, long_groups)
    is_wide_matrix = first_column in _GENE_COLUMNS and len(preview.columns) >= 2

    if backend == "xena":
        if preview.delimiter not in {None, "\t"}:
            issues.append(
                _issue(
                    "error",
                    "preview.delimiter",
                    "Xena matrix files must be tab-delimited for lazy gene-row reads.",
                    details={"delimiter": preview.delimiter},
                )
            )
        if not is_wide_matrix:
            issues.append(
                _issue(
                    "error",
                    "preview.columns",
                    "Xena bulk expression datasets require a gene x sample matrix.",
                    details={
                        "expected_first_column_any_of": sorted(_GENE_COLUMNS),
                        "columns": preview.columns,
                        "source_role": source_role,
                    },
                )
            )
        return

    if source_role == "matrix" and is_wide_matrix:
        issues.append(
            _issue(
                "error",
                "preview.columns",
                "Wide expression matrix detected; this backend expects long expression rows.",
                details={"columns": preview.columns[:8], "backend": backend},
            )
        )
        return

    _append_missing_columns_issue(
        issues,
        data_model="bulk",
        field="preview.columns",
        missing=long_missing,
        expected=long_groups,
        columns=preview.columns,
    )


def _validate_clinical_preview(
    issues: list[IngestValidationIssue],
    *,
    preview: UploadPreview,
) -> None:
    columns = _normalized_columns(preview)
    expected = {
        "sample": _SAMPLE_COLUMNS,
        "time": _TIME_COLUMNS,
        "event": _EVENT_COLUMNS,
    }
    _append_missing_columns_issue(
        issues,
        data_model="clinical",
        field="preview.columns",
        missing=_missing_column_groups(columns, expected),
        expected=expected,
        columns=preview.columns,
    )


def _validate_qtl_preview(
    issues: list[IngestValidationIssue],
    *,
    preview: UploadPreview,
) -> None:
    columns = _normalized_columns(preview)
    expected = {
        "gene": _GENE_COLUMNS,
        "variant": _VARIANT_COLUMNS,
        "tissue": {"tissue"},
        "phenotype": {"phenotype"},
        "beta": {"beta", "effect", "effect_size"},
        "se": {"se", "stderr", "standard_error"},
        "pvalue": _PVALUE_COLUMNS,
        "qvalue": {"qvalue", "q_value", "fdr"},
    }
    _append_missing_columns_issue(
        issues,
        data_model="qtl",
        field="preview.columns",
        missing=_missing_column_groups(columns, expected),
        expected=expected,
        columns=preview.columns,
    )


def _append_preview_schema_issues(
    issues: list[IngestValidationIssue],
    *,
    payload: IngestRequest,
    source_role: str | None,
    preview: UploadPreview | None,
) -> None:
    if source_role in _OBJECT_SOURCE_ROLES:
        issues.append(
            _issue(
                "info",
                "source",
                (
                    "Object-format validation is currently path-level; worker dry-runs "
                    "will validate internals."
                ),
                details={"source_role": source_role, "backend": payload.backend.value},
            )
        )
        return
    if preview is None:
        return
    data_model = payload.data_model.value
    if not preview.columns:
        issues.append(
            _issue(
                "error",
                "preview.columns",
                "Tabular source preview did not expose a header row.",
                details={"warnings": preview.warnings},
            )
        )
        return
    if data_model == "bulk":
        _validate_bulk_preview(
            issues,
            backend=payload.backend.value,
            source_role=source_role,
            preview=preview,
        )
    elif data_model == "clinical":
        _validate_clinical_preview(issues, preview=preview)
    elif data_model == "qtl":
        _validate_qtl_preview(issues, preview=preview)


def _local_storage_ready(storage_uri: str | None) -> bool:
    if not storage_uri:
        return False
    path = _path_from_uri(storage_uri)
    return True if path is None else path.exists()


def _validate_ingest_payload(
    payload: IngestRequest,
    settings: Settings,
    *,
    preview: UploadPreview | None = None,
) -> IngestValidationReport:
    issues: list[IngestValidationIssue] = []
    dataset_type: DatasetType | None = None
    data_model = payload.data_model.value
    required_roles = sorted(_SOURCE_ROLES_BY_MODEL.get(data_model, set()))
    present_roles = sorted(payload.source)
    source_role = _source_role_for_validation(payload)
    effective_preview = preview
    storage_uri: str | None = None
    storage_ready = False

    for field, value in (("dataset", payload.dataset), ("version", payload.version)):
        try:
            _validated_identifier(value, field)
        except ValidationError as exc:
            issues.append(_issue("error", field, exc.message, details=exc.details))

    try:
        dataset_type = _dataset_type_for_model(payload)
    except ValidationError as exc:
        issues.append(_issue("error", "data_model", exc.message, details=exc.details))

    supported_backends = _QUERY_BACKENDS_BY_MODEL.get(data_model, set())
    if supported_backends and payload.backend.value not in supported_backends:
        issues.append(
            _issue(
                "warning",
                "backend",
                (
                    "Backend can be registered, but the current server may not query "
                    "this data model through it."
                ),
                details={
                    "backend": payload.backend.value,
                    "query_backends": sorted(supported_backends),
                },
            )
        )

    if required_roles and not payload.source:
        issues.append(
            _issue(
                "warning",
                "source",
                (
                    "No source file or storage role was provided; this will be "
                    "metadata-only until data is loaded."
                ),
                details={"required_source_roles": required_roles},
            )
        )
    elif required_roles:
        unknown_roles = sorted(set(payload.source) - set(required_roles))
        for role in unknown_roles:
            issues.append(
                _issue(
                    "warning",
                    f"source.{role}",
                    "Source role is not standard for this data model.",
                    details={"data_model": data_model, "known_roles": required_roles},
                )
            )
        if not set(payload.source) & set(required_roles):
            issues.append(
                _issue(
                    "warning",
                    "source",
                    "No queryable source role was detected for this data model.",
                    details={
                        "required_source_roles": required_roles,
                        "present_roles": present_roles,
                    },
                )
            )

    if dataset_type is not None:
        try:
            dataset_create = _dataset_create_from_ingest(payload)
            storage_uri = dataset_create.storage_uri
            validate_dataset_storage(settings, dataset_create)
            storage_ready = _local_storage_ready(dataset_create.storage_uri)
            _append_path_warnings(issues, field="storage_uri", value=dataset_create.storage_uri)
            for key, value in dataset_create.metadata.items():
                if key.endswith("_uri") and isinstance(value, str):
                    _append_path_warnings(issues, field=f"metadata.{key}", value=value)
            if effective_preview is None:
                effective_preview = _preview_source_uri(storage_uri, source_role)
        except ValidationError as exc:
            issues.append(
                _issue(
                    "error",
                    exc.details.get("field", "storage"),
                    exc.message,
                    details=exc.details,
                )
            )
    else:
        storage_uri = _default_storage_uri(payload)
        storage_ready = _local_storage_ready(storage_uri)

    _append_preview_schema_issues(
        issues,
        payload=payload,
        source_role=source_role,
        preview=effective_preview,
    )

    has_errors = any(issue.level == "error" for issue in issues)
    queryable = (
        not has_errors
        and storage_ready
        and data_model in _QUERY_BACKENDS_BY_MODEL
        and payload.backend.value in _QUERY_BACKENDS_BY_MODEL[data_model]
    )
    return IngestValidationReport(
        valid=not has_errors,
        queryable=queryable,
        dataset=payload.dataset,
        version=payload.version,
        data_model=payload.data_model,
        backend=payload.backend,
        dataset_type=dataset_type,
        required_source_roles=required_roles,
        present_source_roles=present_roles,
        storage_uri=storage_uri,
        issues=issues,
        preview=effective_preview,
    )


def _prepare_sources_sync(
    payload: IngestRequest,
    settings: Settings,
) -> tuple[IngestRequest, list[DatasetAssetCreate]]:
    source = dict(payload.source)
    assets: list[DatasetAssetCreate] = []
    storage_uri = payload.storage_uri
    optimized = False

    for role, uri in payload.source.items():
        path = _path_from_uri(uri)
        if path is None:
            continue
        if not path.exists() or not path.is_file():
            assets.append(infer_asset(role, path))
            continue

        is_xena_matrix = payload.backend.value == "xena" and role in {"expression", "matrix"}
        is_gzip = path.name.lower().endswith((".gz", ".bgz"))
        if is_xena_matrix and is_gzip:
            original_role = f"source.{role}"
            assets.append(infer_asset(original_role, path))
            target_dir = (
                Path(settings.local_data_root) / "optimized" / payload.dataset / payload.version
            )
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / path.name.removesuffix(".gz").removesuffix(".bgz")
            temporary = target.with_suffix(f"{target.suffix}.tmp")
            if not target.exists() or target.stat().st_mtime < path.stat().st_mtime:
                with gzip.open(path, "rb") as source_handle, temporary.open("wb") as target_handle:
                    shutil.copyfileobj(source_handle, target_handle, length=1024 * 1024)
                temporary.replace(target)
            index_path = Path(f"{target}.idx.json")
            if not index_path.exists() or index_path.stat().st_mtime < target.stat().st_mtime:
                build_xena_matrix_index(target, index_path)
            assets.append(infer_asset(role, target, derived_from=original_role))
            assets.append(infer_asset(f"index.{role}", index_path, derived_from=role))
            source[role] = str(target)
            if storage_uri in {None, uri}:
                storage_uri = str(target)
            optimized = True
            continue

        assets.append(infer_asset(role, path))
        if is_xena_matrix:
            index_path = Path(f"{path}.idx.json")
            if not index_path.exists() or index_path.stat().st_mtime < path.stat().st_mtime:
                build_xena_matrix_index(path, index_path)
            assets.append(infer_asset(f"index.{role}", index_path, derived_from=role))

    metadata = dict(payload.metadata)
    metadata["source"] = source
    if optimized:
        metadata["optimization"] = {
            "strategy": "xena_uncompressed_row_index",
            "source_preserved": True,
        }
    prepared = payload.model_copy(
        update={"source": source, "storage_uri": storage_uri, "metadata": metadata}
    )
    return prepared, assets


async def _prepare_sources(
    payload: IngestRequest,
    settings: Settings,
) -> tuple[IngestRequest, list[DatasetAssetCreate]]:
    return await asyncio.to_thread(_prepare_sources_sync, payload, settings)


async def _handle_ingest_request(
    payload: IngestRequest,
    request: Request,
    *,
    preview: UploadPreview | None = None,
) -> IngestResponse:
    registry: DatasetRegistryService = get_registry(request)
    settings: Settings = get_settings(request)
    store: InMemoryJobStore = request.app.state.job_store
    job = store.create(
        JobCreate(type="ingest", spec=payload.model_dump(mode="json", by_alias=True)),
        message="Queued ingest request.",
    )
    if not payload.register_dataset:
        return IngestResponse(
            status=APIStatus.accepted,
            job_id=job.job_id,
            state=job.state,
            dataset=payload.dataset,
            version=payload.version,
            registered=False,
            message="Queued; durable ingest workers are not configured in this deployment.",
            preview=preview,
            data=job,
        )

    try:
        report = _validate_ingest_payload(payload, settings, preview=preview)
        if not report.valid:
            raise ValidationError(
                "Ingest request failed validation.",
                details={"issues": [issue.model_dump(mode="json") for issue in report.issues]},
            )
        payload, assets = await _prepare_sources(payload, settings)
        dataset_create = _dataset_create_from_ingest(payload)
        validate_dataset_storage(settings, dataset_create)
        dataset = await registry.upsert(dataset_create)
        for asset in assets:
            await registry.add_asset(dataset.dataset_id, dataset.version, asset)
        principal = request.state.principal
        await request.app.state.access_service.audit(
            action="dataset.upsert",
            resource_type="dataset",
            resource_id=dataset.dataset_id,
            actor_user_id=principal.user_id,
            metadata={"version": dataset.version},
        )
    except Exception as exc:
        store.fail(job.job_id, error=str(exc), message="Ingest registration failed.")
        raise

    completed = store.complete(
        job.job_id,
        result={
            "dataset": dataset.model_dump(mode="json"),
            **({"preview": preview.model_dump(mode="json")} if preview else {}),
        },
        message="Dataset version and assets registered; supported read indexes are ready.",
    )
    return IngestResponse(
        status=APIStatus.success,
        job_id=completed.job_id,
        state=completed.state,
        dataset=payload.dataset,
        version=payload.version,
        registered=True,
        message=completed.message,
        preview=preview,
        data=completed,
    )


@router.post("/validate", response_model=IngestValidationReport)
async def validate_ingest_job(
    payload: IngestRequest,
    request: Request,
) -> IngestValidationReport:
    settings: Settings = get_settings(request)
    return _validate_ingest_payload(payload, settings)


def _payload_from_uploaded_file(
    *,
    dataset: str,
    version: str,
    data_model: str,
    backend: str,
    role: str,
    target: Path,
    filename: str,
    content_type: str | None,
    size: int,
    preview: UploadPreview,
    metadata_json: str | None,
    options_json: str | None,
    dataset_type: str | None,
    citation: str | None,
    status: str,
    is_default: bool,
    schema_version: str,
    visibility: str,
    register_dataset: bool,
) -> IngestRequest:
    metadata = _json_form_object(metadata_json, "metadata_json")
    options = _json_form_object(options_json, "options_json")
    metadata.setdefault(
        "upload",
        {
            "filename": filename,
            "content_type": content_type,
            "size_bytes": size,
            "preview": preview.model_dump(mode="json"),
        },
    )
    return IngestRequest(
        dataset=dataset,
        version=version,
        data_model=data_model,
        backend=backend,
        source={role: str(target)},
        options=options,
        metadata=metadata,
        dataset_type=dataset_type,
        storage_uri=str(target),
        citation=citation,
        status=status,
        is_default=is_default,
        schema_version=schema_version,
        visibility=visibility,
        register=register_dataset,
    )


async def _save_and_preview_upload(
    *,
    file: UploadFile,
    dataset: str,
    version: str,
    role: str,
    settings: Settings,
) -> tuple[str, Path, int, UploadPreview]:
    dataset = _validated_identifier(dataset, "dataset")
    version = _validated_identifier(version, "version")
    _validated_identifier(role, "role")
    filename = _safe_filename(file.filename)
    target = _upload_target(settings, dataset=dataset, version=version, filename=filename)
    size = await _save_upload(file, target, max_bytes=settings.max_upload_bytes)
    preview = _preview_upload(
        target,
        filename=filename,
        content_type=file.content_type,
        size_bytes=size,
    )
    return filename, target, size, preview


@router.post("", response_model=IngestResponse)
async def create_ingest_job(
    payload: IngestRequest,
    request: Request,
    registry: DatasetRegistryService = Depends(get_registry),
) -> IngestResponse:
    del registry
    return await _handle_ingest_request(payload, request)


@router.post("/upload/validate", response_model=IngestValidationReport)
async def validate_uploaded_ingest_file(
    file: UploadFile = File(...),
    dataset: str = Form(...),
    version: str = Form(...),
    data_model: str = Form(...),
    backend: str = Form(...),
    role: str = Form(default="file"),
    metadata_json: str | None = Form(default=None),
    options_json: str | None = Form(default=None),
    dataset_type: str | None = Form(default=None),
    citation: str | None = Form(default=None),
    status: str = Form(default="active"),
    is_default: bool = Form(default=False),
    schema_version: str = Form(default="1.0"),
    visibility: str = Form(default="public"),
    settings: Settings = Depends(get_settings),
) -> IngestValidationReport:
    filename, target, size, preview = await _save_and_preview_upload(
        file=file,
        dataset=dataset,
        version=version,
        role=role,
        settings=settings,
    )
    payload = _payload_from_uploaded_file(
        dataset=dataset,
        version=version,
        data_model=data_model,
        backend=backend,
        role=role,
        target=target,
        filename=filename,
        content_type=file.content_type,
        size=size,
        preview=preview,
        metadata_json=metadata_json,
        options_json=options_json,
        dataset_type=dataset_type,
        citation=citation,
        status=status,
        is_default=is_default,
        schema_version=schema_version,
        visibility=visibility,
        register_dataset=True,
    )
    return _validate_ingest_payload(payload, settings, preview=preview)


@router.post("/upload", response_model=IngestResponse)
async def upload_ingest_file(
    request: Request,
    file: UploadFile = File(...),
    dataset: str = Form(...),
    version: str = Form(...),
    data_model: str = Form(...),
    backend: str = Form(...),
    role: str = Form(default="file"),
    metadata_json: str | None = Form(default=None),
    options_json: str | None = Form(default=None),
    dataset_type: str | None = Form(default=None),
    citation: str | None = Form(default=None),
    status: str = Form(default="active"),
    is_default: bool = Form(default=False),
    schema_version: str = Form(default="1.0"),
    visibility: str = Form(default="public"),
    register_dataset: bool = Form(default=True, alias="register"),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    filename, target, size, preview = await _save_and_preview_upload(
        file=file,
        dataset=dataset,
        version=version,
        role=role,
        settings=settings,
    )
    payload = _payload_from_uploaded_file(
        dataset=dataset,
        version=version,
        data_model=data_model,
        backend=backend,
        role=role,
        target=target,
        filename=filename,
        content_type=file.content_type,
        size=size,
        preview=preview,
        metadata_json=metadata_json,
        options_json=options_json,
        dataset_type=dataset_type,
        citation=citation,
        status=status,
        is_default=is_default,
        schema_version=schema_version,
        visibility=visibility,
        register_dataset=register_dataset,
    )
    return await _handle_ingest_request(payload, request, preview=preview)


@router.get("/{job_id}", response_model=JobResponse)
async def get_ingest_job(job_id: str, request: Request) -> JobResponse:
    store: InMemoryJobStore = request.app.state.job_store
    return JobResponse(data=store.get(job_id))
