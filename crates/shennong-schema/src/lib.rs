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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    Public,
    #[default]
    Private,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourcePermissions {
    #[serde(default)]
    pub visibility: Visibility,
    #[serde(default = "default_read_scopes")]
    pub read_scopes: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionError {
    Malformed,
    InvalidScope,
}

impl std::fmt::Display for PermissionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Malformed => "permissions must contain a valid visibility and read_scopes array",
            Self::InvalidScope => "permissions contain an invalid read scope",
        })
    }
}

impl ResourcePermissions {
    pub fn from_value(value: &Value) -> Result<Self, PermissionError> {
        let permissions: Self =
            serde_json::from_value(value.clone()).map_err(|_| PermissionError::Malformed)?;
        permissions.validate()?;
        Ok(permissions)
    }

    pub fn as_value(&self) -> Value {
        json!({"visibility": self.visibility, "read_scopes": self.read_scopes})
    }

    pub fn validate(&self) -> Result<(), PermissionError> {
        if self.read_scopes.is_empty()
            || self.read_scopes.iter().any(|scope| {
                scope.is_empty()
                    || scope.len() > 128
                    || !scope.chars().all(|character| {
                        character.is_ascii_alphanumeric()
                            || matches!(character, '.' | ':' | '-' | '_')
                    })
            })
        {
            return Err(PermissionError::InvalidScope);
        }
        Ok(())
    }
}

impl Default for ResourcePermissions {
    fn default() -> Self {
        Self {
            visibility: Visibility::Private,
            read_scopes: default_read_scopes(),
        }
    }
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
    #[serde(default)]
    pub permissions: ResourcePermissions,
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

fn default_read_scopes() -> Vec<String> {
    vec!["resource.read".into()]
}

fn default_token_scopes() -> Vec<String> {
    default_read_scopes()
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
    pub files: Vec<ProviderFile>,
    #[serde(default)]
    pub resource_schema: Value,
    #[serde(default)]
    pub resource_spec: Value,
    #[serde(default)]
    pub storage: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderFile {
    pub id: String,
    pub download: String,
    pub filename: String,
    pub format: String,
    pub download_size: u64,
    pub size: u64,
    pub checksum: Option<String>,
    pub compression: Option<String>,
    pub index: Option<String>,
    #[serde(default)]
    pub schema: Value,
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
            query_operations: vec!["expression", "survival_expression", "embedding_expression"],
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
                "context": {"disease": "Resource-declared exact label", "sample_type": "Resource-declared exact label"},
                "options": {"limit": "1..100000"}
            }),
        }
    }
}

pub fn default_permissions() -> Value {
    ResourcePermissions::default().as_value()
}

#[cfg(test)]
mod tests {
    use super::{ResourcePermissions, ResourceUpsert, Visibility};
    use serde_json::json;

    #[test]
    fn missing_visibility_defaults_to_private() {
        let resource: ResourceUpsert = serde_json::from_value(json!({
            "id":"fixture",
            "kind":"Dataset",
            "permissions":{"read_scopes":["resource.read"]}
        }))
        .unwrap();
        assert_eq!(resource.permissions.visibility, Visibility::Private);
    }

    #[test]
    fn permissions_reject_unknown_visibility_and_invalid_scopes() {
        assert!(
            ResourcePermissions::from_value(&json!({
                "visibility":"published",
                "read_scopes":["resource.read"]
            }))
            .is_err()
        );
        assert!(
            ResourcePermissions::from_value(&json!({
                "visibility":"private",
                "read_scopes":["not a scope"]
            }))
            .is_err()
        );
    }
}
