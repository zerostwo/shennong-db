use async_trait::async_trait;
use serde_json::Value;
use shennong_schema::{Artifact, Resource, ResourceQuery};
use shennong_storage::{ArtifactUri, BlobStore, ByteRange};
#[cfg(test)]
use std::{
    fs::File,
    io::{Seek, SeekFrom},
    path::Path,
};
use std::{
    io::{BufRead, BufReader, Cursor},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader as AsyncBufReader},
    process::{Child, Command},
    sync::Semaphore,
};

pub const MAX_QUERY_ROWS: u64 = 10_000;
pub const MAX_QUERY_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
const TILED_B_IO_CHUNK_BYTES: usize = 8 * 1024;
const MAX_METADATA_ROWS: usize = 1_000_000;
const MAX_METADATA_LINE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Error)]
pub enum QueryError {
    #[error("resource operation is unsupported")]
    Unsupported,
    #[error("resource has no compatible expression artifact")]
    NoArtifact,
    #[error("expression artifact is malformed")]
    MalformedArtifact,
    #[error(transparent)]
    Storage(#[from] shennong_storage::StorageError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error("query backend is unavailable")]
    BackendUnavailable,
    #[error("query backend timed out")]
    BackendTimeout,
    #[error("query backend is busy")]
    BackendBusy,
    #[error("query backend output exceeded its configured limit")]
    BackendOutputTooLarge,
    #[error("query response exceeded its configured limit")]
    ResponseTooLarge,
}

#[derive(Clone)]
pub struct TiledbExecutor {
    python: String,
    semaphore: Arc<Semaphore>,
    timeout: Duration,
    max_stdout_bytes: usize,
    max_stderr_bytes: usize,
}

impl TiledbExecutor {
    pub fn new(
        python: impl Into<String>,
        max_concurrency: usize,
        timeout: Duration,
        max_stdout_bytes: usize,
        max_stderr_bytes: usize,
    ) -> Self {
        Self {
            python: python.into(),
            semaphore: Arc::new(Semaphore::new(max_concurrency.max(1))),
            timeout,
            max_stdout_bytes: max_stdout_bytes.max(1),
            max_stderr_bytes: max_stderr_bytes.max(1),
        }
    }
}

pub async fn execute_tiledb_expression(
    executor: &TiledbExecutor,
    script: &str,
    resource: &Resource,
    query: &ResourceQuery,
) -> Result<Value, QueryError> {
    let uri = resource
        .spec
        .get("array_uri")
        .and_then(Value::as_str)
        .ok_or(QueryError::Unsupported)?;
    let feature = query.feature.as_ref().ok_or(QueryError::Unsupported)?;
    let limit = query
        .options
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(1_000)
        .clamp(1, MAX_QUERY_ROWS);
    let offset = query
        .options
        .get("cursor")
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        })
        .unwrap_or(0);
    let limit = limit.to_string();
    let offset = offset.to_string();
    let output = run_tiledb(
        executor,
        [
            script,
            "query",
            "--uri",
            uri,
            "--feature",
            &feature.name,
            "--limit",
            &limit,
            "--offset",
            &offset,
        ],
    )
    .await?;
    let mut response: Value = serde_json::from_slice(&output)?;
    response["meta"]["dataset"] = resource.id.clone().into();
    response["meta"]["version"] = resource
        .spec
        .get("version")
        .cloned()
        .unwrap_or_else(|| "latest".into());
    Ok(response)
}

pub async fn resolve_tiledb_gene(
    executor: &TiledbExecutor,
    script: &str,
    resource: &Resource,
    feature: &str,
) -> Result<Value, QueryError> {
    let uri = resource
        .spec
        .get("array_uri")
        .and_then(Value::as_str)
        .ok_or(QueryError::Unsupported)?;
    Ok(serde_json::from_slice(
        &run_tiledb(
            executor,
            [script, "resolve", "--uri", uri, "--feature", feature],
        )
        .await?,
    )?)
}

pub async fn execute_clickhouse_expression(
    client: &reqwest::Client,
    endpoint: &str,
    resource: &Resource,
    query: &ResourceQuery,
) -> Result<Option<Value>, QueryError> {
    let feature = query.feature.as_ref().ok_or(QueryError::Unsupported)?;
    let version = query
        .version
        .as_deref()
        .or_else(|| resource.spec.get("version").and_then(Value::as_str))
        .unwrap_or("latest");
    let limit = query
        .options
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(1_000)
        .clamp(1, MAX_QUERY_ROWS);
    let offset = query
        .options
        .get("cursor")
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        })
        .unwrap_or(0);
    let statement = format!(
        "SELECT sample_id, anyLast(value) AS value FROM shennong.expression_cache WHERE dataset = '{}' AND version = '{}' AND feature = '{}' GROUP BY sample_id ORDER BY sample_id LIMIT {limit} OFFSET {offset} FORMAT JSON",
        quote(&resource.id),
        quote(version),
        quote(&feature.name),
    );
    let payload = read_bounded_json(
        client
            .get(endpoint)
            .query(&[("query", statement)])
            .send()
            .await?
            .error_for_status()?,
        MAX_QUERY_RESPONSE_BYTES,
    )
    .await?;
    let rows = payload
        .get("data")
        .and_then(Value::as_array)
        .ok_or(QueryError::MalformedArtifact)?;
    if rows.is_empty() {
        return Ok(None);
    }
    let data: Vec<_> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "observation_id": row.get("sample_id"),
                "sample_id": row.get("sample_id"),
                "feature_id": feature.name,
                "feature_symbol": feature.name,
                "feature": feature.name,
                "measure": "expression",
                "value": row.get("value"),
            })
        })
        .collect();
    Ok(Some(serde_json::json!({
        "status": "success",
        "data": data,
        "meta": {
            "dataset": resource.id,
            "version": version,
            "backend": "clickhouse",
            "n_rows": data.len(),
            "columns": ["sample_id", "feature_symbol", "value"],
            "elapsed_ms": 0.0
        }
    })))
}

pub async fn cache_clickhouse_expression(
    client: &reqwest::Client,
    endpoint: &str,
    resource: &Resource,
    query: &ResourceQuery,
    response: &Value,
) -> Result<(), QueryError> {
    let feature = query.feature.as_ref().ok_or(QueryError::Unsupported)?;
    let version = query
        .version
        .as_deref()
        .or_else(|| resource.spec.get("version").and_then(Value::as_str))
        .unwrap_or("latest");
    let lines = response
        .get("data")
        .and_then(Value::as_array)
        .ok_or(QueryError::MalformedArtifact)?
        .iter()
        .filter_map(|row| {
            Some(
                serde_json::json!({
                    "dataset": resource.id,
                    "version": version,
                    "feature": feature.name,
                    "sample_id": row.get("sample_id")?.as_str()?,
                    "value": row.get("value")?.as_f64()?,
                })
                .to_string(),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    if lines.is_empty() {
        return Ok(());
    }
    if lines.len() > MAX_QUERY_RESPONSE_BYTES {
        return Err(QueryError::ResponseTooLarge);
    }
    client
        .post(endpoint)
        .query(&[(
            "query",
            "INSERT INTO shennong.expression_cache FORMAT JSONEachRow",
        )])
        .body(lines)
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

async fn run_tiledb<'a>(
    executor: &TiledbExecutor,
    arguments: impl IntoIterator<Item = &'a str>,
) -> Result<Vec<u8>, QueryError> {
    let _permit = executor
        .semaphore
        .clone()
        .try_acquire_owned()
        .map_err(|_| QueryError::BackendBusy)?;
    let mut child = Command::new(&executor.python)
        .args(arguments)
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().ok_or(QueryError::BackendUnavailable)?;
    let stderr = child.stderr.take().ok_or(QueryError::BackendUnavailable)?;
    let result = tokio::time::timeout(executor.timeout, async {
        let (stdout, _stderr, status) = tokio::try_join!(
            read_capped(stdout, executor.max_stdout_bytes),
            read_capped(stderr, executor.max_stderr_bytes),
            async { child.wait().await.map_err(QueryError::Io) },
        )?;
        if !status.success() {
            return Err(QueryError::BackendUnavailable);
        }
        Ok(stdout)
    })
    .await;
    match result {
        Ok(Ok(stdout)) => Ok(stdout),
        Ok(Err(error)) => {
            stop_child(&mut child).await;
            Err(error)
        }
        Err(_) => {
            stop_child(&mut child).await;
            Err(QueryError::BackendTimeout)
        }
    }
}

async fn stop_child(child: &mut Child) {
    if child.try_wait().ok().flatten().is_none() {
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
}

async fn read_capped<R: AsyncRead + Unpin>(
    mut reader: R,
    max_bytes: usize,
) -> Result<Vec<u8>, QueryError> {
    let mut output = Vec::new();
    let mut buffer = [0; TILED_B_IO_CHUNK_BYTES];
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(count) > max_bytes {
            return Err(QueryError::BackendOutputTooLarge);
        }
        output.extend_from_slice(&buffer[..count]);
    }
}

async fn read_bounded_json(
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Result<Value, QueryError> {
    if response
        .content_length()
        .is_some_and(|size| size > max_bytes as u64)
    {
        return Err(QueryError::ResponseTooLarge);
    }
    let mut output = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if output.len().saturating_add(chunk.len()) > max_bytes {
            return Err(QueryError::ResponseTooLarge);
        }
        output.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&output)?)
}

fn quote(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "''")
}

#[async_trait]
pub trait QueryAdapter: Send + Sync {
    async fn execute(
        &self,
        resource: &Resource,
        artifacts: &[Artifact],
        query: &ResourceQuery,
    ) -> Result<Value, QueryError>;
}

pub struct QueryPlanner;

impl QueryPlanner {
    pub fn validate(&self, resource: &Resource, query: &ResourceQuery) -> Result<(), QueryError> {
        let operations = resource
            .spec
            .get("operations")
            .and_then(Value::as_array)
            .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>())
            .unwrap_or_else(|| vec!["expression", "embedding_expression"]);
        let context = if query.context.is_null() {
            None
        } else {
            Some(query.context.as_object().ok_or(QueryError::Unsupported)?)
        };
        let supported_context = resource
            .metadata
            .get("supported_context")
            .and_then(Value::as_array)
            .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>())
            .unwrap_or_default();
        if !operations.contains(&query.operation.as_str())
            || query.feature.as_ref().is_none_or(|feature| {
                feature.feature_type != "gene"
                    || feature.name.is_empty()
                    || feature.name.len() > 256
            })
            || query
                .options
                .get("limit")
                .and_then(Value::as_u64)
                .is_some_and(|limit| limit > MAX_QUERY_ROWS)
            || context.is_some_and(|values| {
                values.len() > 20
                    || values.iter().any(|(key, value)| {
                        key.len() > 64
                            || !supported_context.contains(&key.as_str())
                            || !valid_context_value(value)
                    })
            })
        {
            return Err(QueryError::Unsupported);
        }
        let _ = resource;
        Ok(())
    }
}

fn valid_context_value(value: &Value) -> bool {
    value.as_str().is_some_and(|value| value.len() <= 256)
        || value.as_array().is_some_and(|values| {
            values.len() <= 20
                && values
                    .iter()
                    .all(|value| value.as_str().is_some_and(|value| value.len() <= 256))
        })
}

pub struct FileExpressionAdapter {
    storage: Arc<dyn BlobStore>,
}

impl FileExpressionAdapter {
    pub fn new<S>(storage: S) -> Self
    where
        S: BlobStore + 'static,
    {
        Self {
            storage: Arc::new(storage),
        }
    }
}

#[async_trait]
impl QueryAdapter for FileExpressionAdapter {
    async fn execute(
        &self,
        resource: &Resource,
        artifacts: &[Artifact],
        query: &ResourceQuery,
    ) -> Result<Value, QueryError> {
        let artifact = artifacts
            .iter()
            .find(|artifact| {
                matches!(artifact.storage_backend.as_str(), "local" | "s3")
                    && matches!(artifact.format.as_str(), "csv" | "tsv" | "txt")
                    && artifact.schema_json.get("role").and_then(Value::as_str)
                        == Some("expression")
            })
            .ok_or(QueryError::NoArtifact)?;
        let artifact_uri =
            ArtifactUri::parse(artifact.storage_uri.as_deref().unwrap_or(&artifact.uri))?;
        let index_uri = artifact
            .schema_json
            .get("index_uri")
            .and_then(Value::as_str)
            .map(ArtifactUri::parse)
            .transpose()?;
        let mut scan_query = query.clone();
        scan_query.options = serde_json::json!({"limit": MAX_QUERY_ROWS});
        let mut response = expression_response_from_blob(
            self.storage.as_ref(),
            resource,
            &scan_query,
            &artifact_uri,
            index_uri.as_ref(),
            artifact
                .content_sha256
                .as_deref()
                .or(artifact.checksum.as_deref()),
        )
        .await?;
        if query
            .context
            .as_object()
            .is_some_and(|values| !values.is_empty())
        {
            let metadata = artifacts
                .iter()
                .find(|artifact| {
                    artifact.schema_json.get("role").and_then(Value::as_str)
                        == Some("sample_metadata")
                })
                .ok_or(QueryError::NoArtifact)?;
            join_metadata_from_blob(
                self.storage.as_ref(),
                &mut response,
                metadata.storage_uri.as_deref().unwrap_or(&metadata.uri),
                Some(&query.context),
                metadata.schema_json.get("context_fields"),
            )
            .await?;
        }
        if query.operation == "survival_expression" {
            let survival = artifacts
                .iter()
                .find(|artifact| {
                    artifact.schema_json.get("role").and_then(Value::as_str)
                        == Some("survival_metadata")
                })
                .ok_or(QueryError::NoArtifact)?;
            join_metadata_from_blob(
                self.storage.as_ref(),
                &mut response,
                survival.storage_uri.as_deref().unwrap_or(&survival.uri),
                None,
                None,
            )
            .await?;
        }
        if query.operation == "embedding_expression" {
            let embedding = artifacts
                .iter()
                .find(|artifact| {
                    matches!(artifact.storage_backend.as_str(), "local" | "s3")
                        && artifact
                            .schema_json
                            .get("role")
                            .and_then(Value::as_str)
                            .is_some_and(|role| role.starts_with("embedding"))
                })
                .ok_or(QueryError::NoArtifact)?;
            attach_embedding_from_blob(
                self.storage.as_ref(),
                &mut response,
                embedding.storage_uri.as_deref().unwrap_or(&embedding.uri),
            )
            .await?;
        }
        truncate_response(&mut response, query);
        Ok(response)
    }
}

fn apply_metadata(
    response: &mut Value,
    rows: &std::collections::HashMap<String, std::collections::HashMap<String, String>>,
    context: Option<&Value>,
    context_fields: Option<&Value>,
) -> Result<(), QueryError> {
    let mappings = context_fields
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let data = response
        .get_mut("data")
        .and_then(Value::as_array_mut)
        .ok_or(QueryError::MalformedArtifact)?;
    data.retain_mut(|row| {
        let Some(sample) = row.get("sample_id").and_then(Value::as_str) else {
            return false;
        };
        let Some(metadata) = rows.get(sample) else {
            return false;
        };
        let matches = context.and_then(Value::as_object).is_none_or(|filters| {
            filters.iter().all(|(key, expected)| {
                let field = mappings.get(key).and_then(Value::as_str).unwrap_or(key);
                let Some(actual) = metadata.get(field) else {
                    return false;
                };
                expected.as_str().is_some_and(|value| value == actual)
                    || expected.as_array().is_some_and(|values| {
                        values
                            .iter()
                            .filter_map(Value::as_str)
                            .any(|value| value == actual)
                    })
            })
        });
        if matches && let Some(object) = row.as_object_mut() {
            object.extend(
                metadata
                    .iter()
                    .filter(|(key, _)| key.as_str() != "sample")
                    .map(|(key, value)| (key.clone(), value.clone().into())),
            );
        }
        matches
    });
    response["meta"]["n_rows"] = data.len().into();
    response["meta"]["backend"] = "local+metadata".into();
    Ok(())
}

#[cfg(test)]
fn join_metadata(
    response: &mut Value,
    input: &str,
    context: Option<&Value>,
    context_fields: Option<&Value>,
) -> Result<(), QueryError> {
    let mut lines = input.lines();
    let columns: Vec<String> = lines
        .next()
        .ok_or(QueryError::MalformedArtifact)?
        .split('\t')
        .map(str::to_owned)
        .collect();
    let rows = lines
        .filter_map(|line| {
            let values: Vec<_> = line.split('\t').collect();
            let sample = values.first()?.to_string();
            let metadata = columns
                .iter()
                .zip(values)
                .map(|(column, value)| (column.clone(), value.to_string()))
                .collect();
            Some((sample, metadata))
        })
        .collect();
    apply_metadata(response, &rows, context, context_fields)
}

async fn join_metadata_from_blob(
    storage: &dyn BlobStore,
    response: &mut Value,
    uri: &str,
    context: Option<&Value>,
    context_fields: Option<&Value>,
) -> Result<(), QueryError> {
    let uri = ArtifactUri::parse(uri)?;
    let mut lines = AsyncBufReader::new(storage.get_stream(&uri).await?).lines();
    let columns: Vec<String> = lines
        .next_line()
        .await?
        .ok_or(QueryError::MalformedArtifact)?
        .split('\t')
        .map(str::to_owned)
        .collect();
    let mut rows = std::collections::HashMap::new();
    while let Some(line) = lines.next_line().await? {
        if line.len() > MAX_METADATA_LINE_BYTES || rows.len() >= MAX_METADATA_ROWS {
            return Err(QueryError::ResponseTooLarge);
        }
        let values: Vec<_> = line.split('\t').collect();
        let Some(sample) = values.first().map(|value| (*value).to_owned()) else {
            continue;
        };
        let metadata = columns
            .iter()
            .zip(values)
            .map(|(column, value)| (column.clone(), value.to_string()))
            .collect();
        rows.insert(sample, metadata);
    }
    apply_metadata(response, &rows, context, context_fields)
}

fn truncate_response(response: &mut Value, query: &ResourceQuery) {
    let limit = query
        .options
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(1_000)
        .clamp(1, MAX_QUERY_ROWS) as usize;
    if let Some(rows) = response.get_mut("data").and_then(Value::as_array_mut) {
        let total = rows.len();
        let offset = query
            .options
            .get("cursor")
            .and_then(|value| {
                value
                    .as_u64()
                    .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
            })
            .unwrap_or(0) as usize;
        let start = offset.min(total);
        let end = start.saturating_add(limit).min(total);
        let page = rows[start..end].to_vec();
        *rows = page;
        response["meta"]["n_rows"] = rows.len().into();
        response["meta"]["total_rows"] = total.into();
        if end < total {
            response["meta"]["next_cursor"] = end.to_string().into();
        } else if let Some(meta) = response.get_mut("meta").and_then(Value::as_object_mut) {
            meta.remove("next_cursor");
        }
    }
}

async fn read_small_text(storage: &dyn BlobStore, uri: &ArtifactUri) -> Result<String, QueryError> {
    const MAX_METADATA_BYTES: u64 = 16 * 1024 * 1024;
    let reader = storage.get_stream(uri).await?;
    let mut value = Vec::new();
    let mut limited = reader.take(MAX_METADATA_BYTES + 1);
    limited.read_to_end(&mut value).await?;
    if value.len() as u64 > MAX_METADATA_BYTES {
        return Err(QueryError::ResponseTooLarge);
    }
    let value = String::from_utf8(value).map_err(|_| QueryError::MalformedArtifact)?;
    Ok(value)
}

async fn expression_response_from_blob(
    storage: &dyn BlobStore,
    resource: &Resource,
    query: &ResourceQuery,
    artifact_uri: &ArtifactUri,
    index_uri: Option<&ArtifactUri>,
    expected_checksum: Option<&str>,
) -> Result<Value, QueryError> {
    let Some(index_uri) = index_uri else {
        let stream = storage.get_stream(artifact_uri).await?;
        let mut reader = AsyncBufReader::new(stream);
        let mut header = String::new();
        if reader.read_line(&mut header).await? == 0 {
            return Err(QueryError::MalformedArtifact);
        }
        let feature = query.feature.as_ref().ok_or(QueryError::Unsupported)?;
        let mut row = String::new();
        loop {
            row.clear();
            if reader.read_line(&mut row).await? == 0 {
                return Err(QueryError::NoArtifact);
            }
            if row
                .split(['\t', ','])
                .next()
                .is_some_and(|value| value == feature.name)
            {
                return expression_response(resource, query, &format!("{header}{row}"));
            }
            if row.len() > MAX_QUERY_RESPONSE_BYTES {
                return Err(QueryError::ResponseTooLarge);
            }
        }
    };
    let index = read_small_text(storage, index_uri).await?;
    let index: Value = serde_json::from_str(&index)?;
    if index["schema_version"] != 2 {
        return Err(QueryError::NoArtifact);
    }
    if let Some(expected) = expected_checksum {
        let expected = expected.strip_prefix("sha256:").unwrap_or(expected);
        if index["matrix_sha256"].as_str() != Some(expected) {
            return Err(QueryError::NoArtifact);
        }
    }
    let feature = query.feature.as_ref().ok_or(QueryError::Unsupported)?;
    let feature_index = index
        .get("features")
        .and_then(|items| items.get(&feature.name))
        .and_then(Value::as_object)
        .ok_or(QueryError::NoArtifact)?;
    let offset = feature_index
        .get("offset")
        .and_then(Value::as_u64)
        .ok_or(QueryError::NoArtifact)?;
    let length = feature_index
        .get("length")
        .and_then(Value::as_u64)
        .filter(|length| *length > 0 && *length <= MAX_QUERY_RESPONSE_BYTES as u64)
        .ok_or(QueryError::NoArtifact)?;
    let meta = storage.head(artifact_uri).await?;
    if offset.saturating_add(length) > meta.size {
        return Err(QueryError::NoArtifact);
    }
    let header_length = index["header"]["length"]
        .as_u64()
        .filter(|length| *length > 0 && *length <= 1024 * 1024)
        .ok_or(QueryError::NoArtifact)?;
    let mut header_reader = storage
        .get_range(
            artifact_uri,
            ByteRange::new(0, header_length - 1).map_err(|_| QueryError::NoArtifact)?,
        )
        .await?;
    let mut header_chunk = Vec::new();
    header_reader.read_to_end(&mut header_chunk).await?;
    let header = String::from_utf8_lossy(&header_chunk)
        .lines()
        .next()
        .ok_or(QueryError::MalformedArtifact)?
        .to_owned();
    let mut row_reader = storage
        .get_range(
            artifact_uri,
            ByteRange::new(offset, offset + length - 1).map_err(|_| QueryError::NoArtifact)?,
        )
        .await?;
    let mut row_chunk = Vec::new();
    row_reader.read_to_end(&mut row_chunk).await?;
    let row = String::from_utf8(row_chunk).map_err(|_| QueryError::MalformedArtifact)?;
    let line = row.lines().next().ok_or(QueryError::NoArtifact)?;
    if line.split(['\t', ',']).next() != Some(feature.name.as_str()) {
        return Err(QueryError::NoArtifact);
    }
    expression_response(resource, query, &format!("{header}\n{line}\n"))
}

fn expression_response(
    resource: &Resource,
    query: &ResourceQuery,
    input: &str,
) -> Result<Value, QueryError> {
    expression_response_from_reader(resource, query, BufReader::new(Cursor::new(input)))
}

#[cfg(test)]
fn expression_response_from_file(
    resource: &Resource,
    query: &ResourceQuery,
    path: &Path,
    index_path: Option<&Path>,
) -> Result<Value, QueryError> {
    let Some(index_path) = index_path else {
        return expression_response_from_reader(resource, query, BufReader::new(File::open(path)?));
    };
    let feature = query.feature.as_ref().ok_or(QueryError::Unsupported)?;
    let offsets: Value = serde_json::from_reader(File::open(index_path)?)?;
    let offset = offsets
        .get("offsets")
        .and_then(|items| items.get(&feature.name))
        .and_then(Value::as_u64)
        .ok_or(QueryError::NoArtifact)?;
    let mut reader = BufReader::new(File::open(path)?);
    let mut header = String::new();
    reader.read_line(&mut header)?;
    reader.seek(SeekFrom::Start(offset))?;
    let mut row = String::new();
    reader.read_line(&mut row)?;
    expression_response(resource, query, &format!("{header}{row}"))
}

fn expression_response_from_reader<R: BufRead>(
    resource: &Resource,
    query: &ResourceQuery,
    mut reader: R,
) -> Result<Value, QueryError> {
    let mut header = String::new();
    if reader.read_line(&mut header)? == 0 {
        return Err(QueryError::MalformedArtifact);
    }
    let header = header.trim_end();
    let delimiter = if header.contains('\t') { '\t' } else { ',' };
    let columns: Vec<_> = header.split(delimiter).collect();
    if columns.len() < 2 {
        return Err(QueryError::MalformedArtifact);
    }
    let feature = query.feature.as_ref().ok_or(QueryError::Unsupported)?;
    let mut line = String::new();
    let row = loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return Err(QueryError::NoArtifact);
        }
        let row: Vec<_> = line.trim_end().split(delimiter).collect();
        if row.first().is_some_and(|value| *value == feature.name) {
            break row;
        }
    };
    let limit = query
        .options
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(1_000)
        .clamp(1, MAX_QUERY_ROWS) as usize;
    let data: Vec<_> = columns.iter().skip(1).zip(row.iter().skip(1)).take(limit).map(|(sample, value)| serde_json::json!({
        "observation_id": sample,
        "sample_id": sample,
        "feature_id": feature.name,
        "feature_symbol": feature.name,
        "feature": feature.name,
        "measure": "expression",
        "value": value.parse::<f64>().ok().map_or_else(|| Value::String((*value).to_string()), Value::from),
    })).collect();
    Ok(serde_json::json!({
        "status": "success",
        "data": data,
        "meta": {
            "dataset": resource.id,
            "version": query.version.as_deref().or_else(|| resource.spec.get("version").and_then(Value::as_str)).unwrap_or("latest"),
            "backend": "local",
            "n_rows": data.len(),
            "columns": ["observation_id", "feature_symbol", "value"],
            "elapsed_ms": 0.0
        }
    }))
}

#[cfg(test)]
fn attach_embedding(response: &mut Value, input: &str) -> Result<(), QueryError> {
    let mut lines = input.lines();
    let header = lines.next().ok_or(QueryError::MalformedArtifact)?;
    let delimiter = if header.contains('\t') { '\t' } else { ',' };
    let columns: Vec<_> = header.split(delimiter).collect();
    let id_index = columns
        .iter()
        .position(|column| matches!(*column, "observation_id" | "sample_id" | "cell_id"))
        .ok_or(QueryError::MalformedArtifact)?;
    let rows: std::collections::HashMap<_, _> = lines
        .map(|line| line.split(delimiter).collect::<Vec<_>>())
        .filter_map(|values| {
            let id = values.get(id_index)?.to_string();
            Some((id, values))
        })
        .collect();
    for row in response
        .get_mut("data")
        .and_then(Value::as_array_mut)
        .ok_or(QueryError::MalformedArtifact)?
    {
        let id = row
            .get("observation_id")
            .and_then(Value::as_str)
            .ok_or(QueryError::MalformedArtifact)?;
        if let Some(values) = rows.get(id) {
            for (index, column) in columns.iter().enumerate() {
                if index != id_index
                    && let Some(value) = values.get(index)
                {
                    row[column] = value
                        .parse::<f64>()
                        .ok()
                        .map_or_else(|| Value::String((*value).to_string()), Value::from);
                }
            }
        }
    }
    Ok(())
}

async fn attach_embedding_from_blob(
    storage: &dyn BlobStore,
    response: &mut Value,
    uri: &str,
) -> Result<(), QueryError> {
    let uri = ArtifactUri::parse(uri)?;
    let mut lines = AsyncBufReader::new(storage.get_stream(&uri).await?).lines();
    let header = lines
        .next_line()
        .await?
        .ok_or(QueryError::MalformedArtifact)?;
    let delimiter = if header.contains('\t') { '\t' } else { ',' };
    let columns: Vec<_> = header.split(delimiter).map(str::to_owned).collect();
    let id_index = columns
        .iter()
        .position(|column| matches!(column.as_str(), "observation_id" | "sample_id" | "cell_id"))
        .ok_or(QueryError::MalformedArtifact)?;
    let mut rows = std::collections::HashMap::new();
    while let Some(line) = lines.next_line().await? {
        if line.len() > MAX_METADATA_LINE_BYTES || rows.len() >= MAX_METADATA_ROWS {
            return Err(QueryError::ResponseTooLarge);
        }
        let values: Vec<_> = line.split(delimiter).map(str::to_owned).collect();
        let Some(id) = values.get(id_index) else {
            continue;
        };
        rows.insert(id.clone(), values);
    }
    for row in response
        .get_mut("data")
        .and_then(Value::as_array_mut)
        .ok_or(QueryError::MalformedArtifact)?
    {
        let id = row
            .get("observation_id")
            .and_then(Value::as_str)
            .ok_or(QueryError::MalformedArtifact)?;
        if let Some(values) = rows.get(id) {
            for (index, column) in columns.iter().enumerate() {
                if index != id_index
                    && let Some(value) = values.get(index)
                {
                    row[column] = value
                        .parse::<f64>()
                        .ok()
                        .map_or_else(|| Value::String(value.clone()), Value::from);
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        MAX_QUERY_ROWS, QueryError, QueryPlanner, TiledbExecutor, attach_embedding,
        execute_clickhouse_expression, execute_tiledb_expression, expression_response,
        expression_response_from_file, join_metadata, truncate_response,
    };
    use chrono::Utc;
    use serde_json::json;
    use shennong_schema::{Resource, ResourceQuery};
    use std::{fs, path::PathBuf, time::Duration};

    fn tiledb_resource(uri: &str) -> Resource {
        Resource {
            id: "pbmc".into(),
            kind: "Dataset".into(),
            metadata: json!({}),
            spec: json!({"backend":"tiledb","array_uri":uri,"operations":["expression"]}),
            status: "available".into(),
            provenance: json!({}),
            permissions: json!({}),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn tiledb_query() -> ResourceQuery {
        serde_json::from_value(json!({
            "resource":"pbmc",
            "operation":"expression",
            "feature":{"type":"gene","name":"YTHDF2"}
        }))
        .unwrap()
    }

    fn tiledb_script() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "shennong-tiledb-test-{}-{}.sh",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        fs::write(
            &path,
            r#"case "$3" in
normal) printf '{"data":[],"meta":{}}' ;;
sleep) sleep 1; touch "$0.completed"; printf '{"data":[],"meta":{}}' ;;
exit) printf 'Traceback: /data/private\n' >&2; exit 3 ;;
stdout) printf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' ;;
stderr) printf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' >&2; exit 4 ;;
esac
"#,
        )
        .unwrap();
        path
    }

    #[test]
    fn rejects_context_filters_until_annotation_resources_exist() {
        let resource = Resource {
            id: "toil".into(),
            kind: "Dataset".into(),
            metadata: json!({}),
            spec: json!({}),
            status: "available".into(),
            provenance: json!({}),
            permissions: json!({}),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let query: ResourceQuery = serde_json::from_value(json!({"resource":"toil","operation":"expression","feature":{"type":"gene","name":"YTHDF2"},"context":{"disease":"SKCM"}})).unwrap();
        assert!(QueryPlanner.validate(&resource, &query).is_err());
    }

    #[test]
    fn filters_expression_with_declared_sample_metadata() {
        let mut response = json!({"data":[
            {"sample_id":"S1","value":1.0},
            {"sample_id":"S2","value":2.0}
        ],"meta":{}});
        join_metadata(
            &mut response,
            "sample\t_sample_type\nS1\tPrimary Tumor\nS2\tSolid Tissue Normal\n",
            Some(&json!({"sample_type":"Primary Tumor"})),
            Some(&json!({"sample_type":"_sample_type"})),
        )
        .unwrap();
        assert_eq!(response["meta"]["n_rows"], 1);
        assert_eq!(response["data"][0]["sample_id"], "S1");
        assert_eq!(response["data"][0]["_sample_type"], "Primary Tumor");
    }

    #[test]
    fn reads_gene_by_sample_matrix_without_loading_a_backend() {
        let resource = Resource {
            id: "toil".into(),
            kind: "Dataset".into(),
            metadata: json!({}),
            spec: json!({}),
            status: "available".into(),
            provenance: json!({}),
            permissions: json!({}),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let query: ResourceQuery = serde_json::from_value(json!({"resource":"toil","operation":"expression","feature":{"type":"gene","name":"YTHDF2"}})).unwrap();
        let response =
            expression_response(&resource, &query, "gene\tS1\tS2\nYTHDF2\t1.2\t3\n").unwrap();
        assert_eq!(response["data"][0]["value"], 1.2);
        assert_eq!(response["meta"]["n_rows"], 2);
    }

    #[test]
    fn applies_the_requested_response_limit() {
        let resource = Resource {
            id: "toil".into(),
            kind: "Dataset".into(),
            metadata: json!({}),
            spec: json!({}),
            status: "available".into(),
            provenance: json!({}),
            permissions: json!({}),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let query: ResourceQuery = serde_json::from_value(json!({"resource":"toil","operation":"expression","feature":{"type":"gene","name":"YTHDF2"},"options":{"limit":1}})).unwrap();
        let response =
            expression_response(&resource, &query, "gene\tS1\tS2\nYTHDF2\t1.2\t3\n").unwrap();
        assert_eq!(response["meta"]["n_rows"], 1);
    }

    #[test]
    fn applies_cursor_pages_without_losing_total_rows() {
        let mut response = json!({"data":[
            {"observation_id":"S1"},
            {"observation_id":"S2"},
            {"observation_id":"S3"},
            {"observation_id":"S4"}
        ],"meta":{}});
        let query: ResourceQuery = serde_json::from_value(json!({
            "resource":"toil","operation":"expression",
            "feature":{"type":"gene","name":"YTHDF2"},
            "options":{"limit":2,"cursor":"1"}
        }))
        .unwrap();
        truncate_response(&mut response, &query);
        assert_eq!(response["data"].as_array().unwrap().len(), 2);
        assert_eq!(response["data"][0]["observation_id"], "S2");
        assert_eq!(response["meta"]["total_rows"], 4);
        assert_eq!(response["meta"]["next_cursor"], "3");
    }

    #[test]
    fn joins_embedding_coordinates_by_observation_id() {
        let mut response = json!({"data":[{"observation_id":"S1"}]});
        attach_embedding(&mut response, "sample_id,UMAP_1,UMAP_2\nS1,1.5,-2\n").unwrap();
        assert_eq!(response["data"][0]["UMAP_1"], 1.5);
        assert_eq!(response["data"][0]["UMAP_2"], -2.0);
    }

    #[test]
    fn reads_indexed_gene_without_scanning_the_matrix() {
        let root = std::env::temp_dir().join(format!("shennong-query-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let matrix = root.join("matrix.tsv");
        let data = "gene\tS1\nA\t1\nB\t2\n";
        std::fs::write(&matrix, data).unwrap();
        let index = root.join("matrix.idx.json");
        std::fs::write(&index, r#"{"offsets":{"B":12}}"#).unwrap();
        let resource = Resource {
            id: "toil".into(),
            kind: "Dataset".into(),
            metadata: json!({}),
            spec: json!({}),
            status: "available".into(),
            provenance: json!({}),
            permissions: json!({}),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let query: ResourceQuery = serde_json::from_value(json!({"resource":"toil","operation":"expression","feature":{"type":"gene","name":"B"}})).unwrap();
        let response =
            expression_response_from_file(&resource, &query, &matrix, Some(&index)).unwrap();
        assert_eq!(response["data"][0]["value"], 2.0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn tilesdb_executor_bounds_process_failures_and_output() {
        let script = tiledb_script();
        let marker = PathBuf::from(format!("{}.completed", script.display()));
        let executor = TiledbExecutor::new("/bin/sh", 1, Duration::from_millis(50), 32, 32);
        let query = tiledb_query();
        assert!(
            execute_tiledb_expression(
                &executor,
                script.to_str().unwrap(),
                &tiledb_resource("normal"),
                &query
            )
            .await
            .is_ok()
        );
        assert!(matches!(
            execute_tiledb_expression(
                &executor,
                script.to_str().unwrap(),
                &tiledb_resource("sleep"),
                &query
            )
            .await,
            Err(QueryError::BackendTimeout)
        ));
        tokio::time::sleep(Duration::from_millis(1100)).await;
        assert!(!marker.exists());
        for uri in ["exit", "stdout", "stderr"] {
            let error = execute_tiledb_expression(
                &executor,
                script.to_str().unwrap(),
                &tiledb_resource(uri),
                &query,
            )
            .await
            .unwrap_err();
            assert!(matches!(
                error,
                QueryError::BackendUnavailable | QueryError::BackendOutputTooLarge
            ));
        }
        fs::remove_file(script).unwrap();
    }

    #[tokio::test]
    async fn tilesdb_executor_rejects_excess_concurrency() {
        let script = tiledb_script();
        let executor = TiledbExecutor::new("/bin/sh", 1, Duration::from_secs(2), 1024, 1024);
        let first_executor = executor.clone();
        let first_script = script.clone();
        let first = tokio::spawn(async move {
            execute_tiledb_expression(
                &first_executor,
                first_script.to_str().unwrap(),
                &tiledb_resource("sleep"),
                &tiledb_query(),
            )
            .await
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(matches!(
            execute_tiledb_expression(
                &executor,
                script.to_str().unwrap(),
                &tiledb_resource("normal"),
                &tiledb_query()
            )
            .await,
            Err(QueryError::BackendBusy)
        ));
        assert!(first.await.unwrap().is_ok());
        fs::remove_file(script).unwrap();
    }

    #[tokio::test]
    async fn clickhouse_client_timeout_is_propagated() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (_socket, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(1)).await;
        });
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_millis(20))
            .timeout(Duration::from_millis(20))
            .build()
            .unwrap();
        assert!(matches!(
            execute_clickhouse_expression(&client, &format!("http://{address}"), &tiledb_resource("normal"), &tiledb_query()).await,
            Err(QueryError::Http(error)) if error.is_timeout()
        ));
    }

    #[test]
    fn rejects_unbounded_query_inputs() {
        let mut resource = tiledb_resource("normal");
        resource.spec = json!({"operations":["expression"]});
        resource.metadata = json!({"supported_context":["sample_type"]});
        let mut query = tiledb_query();
        query.feature.as_mut().unwrap().name = "x".repeat(257);
        assert!(QueryPlanner.validate(&resource, &query).is_err());
        query.feature.as_mut().unwrap().name = "YTHDF2".into();
        query.options = json!({"limit": MAX_QUERY_ROWS + 1});
        assert!(QueryPlanner.validate(&resource, &query).is_err());
        query.options = json!({});
        query.context = json!({"sample_type":"x".repeat(257)});
        assert!(QueryPlanner.validate(&resource, &query).is_err());
    }
}
