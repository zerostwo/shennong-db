use async_trait::async_trait;
use serde_json::Value;
use shennong_schema::{Artifact, Resource, ResourceQuery};
use shennong_storage::{LocalObjectStorage, ObjectStorage};
use std::{
    fs::File,
    io::{BufRead, BufReader, Cursor, Seek, SeekFrom},
    path::Path,
};
use thiserror::Error;

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
        let supported = ["expression", "embedding_expression"];
        if !supported.contains(&query.operation.as_str())
            || query
                .feature
                .as_ref()
                .is_none_or(|feature| feature.feature_type != "gene")
        {
            return Err(QueryError::Unsupported);
        }
        let _ = resource;
        Ok(())
    }
}

pub struct FileExpressionAdapter {
    storage: LocalObjectStorage,
}

impl FileExpressionAdapter {
    pub fn new(storage: LocalObjectStorage) -> Self {
        Self { storage }
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
                artifact.storage_backend == "local"
                    && matches!(artifact.format.as_str(), "csv" | "tsv" | "txt")
            })
            .ok_or(QueryError::NoArtifact)?;
        let path = self.storage.resolve(&artifact.uri)?;
        let index = artifact
            .schema_json
            .get("index_uri")
            .and_then(Value::as_str)
            .map(|uri| self.storage.resolve(uri))
            .transpose()?;
        let mut response = expression_response_from_file(resource, query, &path, index.as_deref())?;
        if query.operation == "embedding_expression" {
            let embedding = artifacts
                .iter()
                .find(|artifact| {
                    artifact.storage_backend == "local"
                        && artifact
                            .schema_json
                            .get("role")
                            .and_then(Value::as_str)
                            .is_some_and(|role| role.starts_with("embedding"))
                })
                .ok_or(QueryError::NoArtifact)?;
            let input =
                String::from_utf8_lossy(&self.storage.read(&embedding.uri).await?).into_owned();
            attach_embedding(&mut response, &input)?;
        }
        Ok(response)
    }
}

fn expression_response(
    resource: &Resource,
    query: &ResourceQuery,
    input: &str,
) -> Result<Value, QueryError> {
    expression_response_from_reader(resource, query, BufReader::new(Cursor::new(input)))
}

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
    let data: Vec<_> = columns.iter().skip(1).zip(row.iter().skip(1)).map(|(sample, value)| serde_json::json!({
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

#[cfg(test)]
mod tests {
    use super::{attach_embedding, expression_response, expression_response_from_file};
    use chrono::Utc;
    use serde_json::json;
    use shennong_schema::{Resource, ResourceQuery};

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
}
