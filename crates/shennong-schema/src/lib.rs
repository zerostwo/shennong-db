use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Resource {
    pub id: String,
    pub kind: String,
    pub metadata: Value,
    pub spec: Value,
    pub status: String,
    pub provenance: Value,
    pub permissions: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResourceUpsert {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub metadata: Value,
    #[serde(default)]
    pub spec: Value,
    #[serde(default = "available")]
    pub status: String,
    #[serde(default)]
    pub provenance: Value,
    #[serde(default = "default_permissions")]
    pub permissions: Value,
}

fn available() -> String {
    "available".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Artifact {
    pub id: String,
    pub resource_id: String,
    #[serde(skip_serializing)]
    pub uri: String,
    pub format: String,
    pub size: Option<i64>,
    pub checksum: Option<String>,
    pub storage_backend: String,
    #[serde(rename = "schema")]
    pub schema_json: Value,
    pub provenance: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ArtifactUpsert {
    pub id: String,
    pub resource_id: String,
    pub uri: String,
    pub format: String,
    pub size: Option<i64>,
    pub checksum: Option<String>,
    pub storage_backend: String,
    #[serde(rename = "schema", default)]
    pub schema_json: Value,
    #[serde(default)]
    pub provenance: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Relation {
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub relation_type: String,
    pub evidence: Value,
    pub provenance: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RelationUpsert {
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub relation_type: String,
    #[serde(default)]
    pub evidence: Value,
    #[serde(default)]
    pub provenance: Value,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AuditEvent {
    pub event_id: String,
    pub actor_user_id: Option<String>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: String,
    pub metadata: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: String,
    pub display_name: String,
    pub email: Option<String>,
    pub role: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UserUpsert {
    pub id: String,
    pub display_name: String,
    pub email: Option<String>,
    pub role: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TokenIssueRequest {
    #[serde(default = "default_token_lifetime")]
    pub expires_in: u64,
    #[serde(default = "default_token_scopes")]
    pub scopes: Vec<String>,
}

fn default_token_lifetime() -> u64 {
    86_400
}

fn default_token_scopes() -> Vec<String> {
    vec!["resource.read".into()]
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResourceQuery {
    pub resource: String,
    pub operation: String,
    pub feature: Option<QueryFeature>,
    #[serde(default)]
    pub context: Value,
    pub embedding: Option<Value>,
    pub version: Option<String>,
    #[serde(default)]
    pub options: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResourceInstallRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderManifest {
    pub name: String,
    #[serde(deserialize_with = "string_or_number")]
    pub version: String,
    pub source: Value,
    pub download: String,
    pub checksum: Option<String>,
    #[serde(default)]
    pub resource_schema: Value,
    #[serde(default)]
    pub storage: Value,
}

fn string_or_number<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Scalar {
        Text(String),
        Integer(i64),
        Float(f64),
    }
    match Scalar::deserialize(deserializer)? {
        Scalar::Text(value) => Ok(value),
        Scalar::Integer(value) => Ok(value.to_string()),
        Scalar::Float(value) => Ok(value.to_string()),
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct QueryFeature {
    #[serde(rename = "type")]
    pub feature_type: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Capabilities {
    pub api_version: &'static str,
    pub resources: [&'static str; 4],
    pub query_operations: Vec<&'static str>,
    pub artifact_formats: [&'static str; 14],
    pub storage_backends: Vec<&'static str>,
    pub query_schema: Value,
}

impl Default for Capabilities {
    fn default() -> Self {
        Self {
            api_version: "v1",
            resources: ["discover", "inspect", "artifacts", "relations"],
            query_operations: vec!["expression", "embedding_expression"],
            artifact_formats: [
                "h5",
                "h5ad",
                "zarr",
                "parquet",
                "csv",
                "tsv",
                "txt",
                "bam",
                "fasta",
                "gtf",
                "sqlite",
                "feather",
                "tiledb",
                "clickhouse",
            ],
            storage_backends: vec!["local", "clickhouse", "tiledb"],
            query_schema: json!({
                "resource": "resource id",
                "operation": "expression",
                "feature": {"type": "gene", "name": "gene symbol"},
                "context": {"disease": "optional disease or cancer code"},
                "options": {"limit": "1..100000"}
            }),
        }
    }
}

pub fn default_permissions() -> Value {
    json!({"visibility": "public", "read_scopes": ["resource.read"]})
}
