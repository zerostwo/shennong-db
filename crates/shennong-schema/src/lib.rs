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
    #[serde(default = "registered")]
    pub status: String,
    #[serde(default)]
    pub provenance: Value,
    #[serde(default)]
    pub permissions: ResourcePermissions,
}

fn registered() -> String {
    "registered".into()
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
    pub data_class: String,
    pub immutable: bool,
    pub content_sha256: Option<String>,
    pub source_uri: Option<String>,
    pub derived_from: Value,
    pub pipeline_version: Option<String>,
    pub retention_policy: Option<String>,
    pub storage_uri: Option<String>,
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
    #[serde(default = "default_data_class")]
    pub data_class: String,
    #[serde(default)]
    pub immutable: bool,
    #[serde(default)]
    pub content_sha256: Option<String>,
    #[serde(default)]
    pub source_uri: Option<String>,
    #[serde(default = "empty_array")]
    pub derived_from: Value,
    #[serde(default)]
    pub pipeline_version: Option<String>,
    #[serde(default)]
    pub retention_policy: Option<String>,
    #[serde(default)]
    pub storage_uri: Option<String>,
    #[serde(rename = "schema", default)]
    pub schema_json: Value,
    #[serde(default)]
    pub provenance: Value,
}

fn default_data_class() -> String {
    "canonical".into()
}

fn empty_array() -> Value {
    Value::Array(Vec::new())
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

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub owner_user_id: String,
    pub visibility: String,
    pub status: String,
    pub metadata: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectUpsert {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub owner_user_id: String,
    #[serde(default = "private_visibility")]
    pub visibility: String,
    #[serde(default = "active_status")]
    pub status: String,
    #[serde(default = "empty_object")]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProjectMember {
    pub project_id: String,
    pub user_id: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMemberUpsert {
    pub project_id: String,
    pub user_id: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Study {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub design_type: String,
    pub status: String,
    pub metadata: Value,
    pub provenance: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyUpsert {
    pub id: String,
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "generic_kind")]
    pub design_type: String,
    #[serde(default = "planning_status")]
    pub status: String,
    #[serde(default = "empty_object")]
    pub metadata: Value,
    #[serde(default = "empty_object")]
    pub provenance: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ResearchEntity {
    pub id: String,
    pub project_id: Option<String>,
    pub study_id: Option<String>,
    pub category: String,
    pub kind: String,
    pub label: String,
    pub ontology_id: Option<String>,
    pub canonical_key: Option<String>,
    pub status: String,
    pub metadata: Value,
    pub provenance: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchEntityUpsert {
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub study_id: Option<String>,
    pub category: String,
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub ontology_id: Option<String>,
    #[serde(default)]
    pub canonical_key: Option<String>,
    #[serde(default = "active_status")]
    pub status: String,
    #[serde(default = "empty_object")]
    pub metadata: Value,
    #[serde(default = "empty_object")]
    pub provenance: Value,
}

pub const RESEARCH_ENTITY_CATEGORIES: &[&str] = &[
    "subject",
    "cohort",
    "sample",
    "biospecimen",
    "aliquot",
    "bioentity",
    "material",
    "reagent",
    "model",
    "data_product",
    "result",
    "observation",
    "claim",
    "external_reference",
    "other",
];

pub fn is_research_entity_category(value: &str) -> bool {
    RESEARCH_ENTITY_CATEGORIES.contains(&value)
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Activity {
    pub id: String,
    pub project_id: String,
    pub study_id: Option<String>,
    pub kind: String,
    pub label: String,
    pub status: String,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub parameters: Value,
    pub provenance: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityUpsert {
    pub id: String,
    pub project_id: String,
    #[serde(default)]
    pub study_id: Option<String>,
    pub kind: String,
    pub label: String,
    #[serde(default = "planned_status")]
    pub status: String,
    #[serde(default)]
    pub started_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub ended_at: Option<DateTime<Utc>>,
    #[serde(default = "empty_object")]
    pub parameters: Value,
    #[serde(default = "empty_object")]
    pub provenance: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ActivityIo {
    pub activity_id: String,
    pub entity_id: String,
    pub direction: String,
    pub role: String,
    pub ordinal: i32,
    pub metadata: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityIoUpsert {
    pub activity_id: String,
    pub entity_id: String,
    pub direction: String,
    pub role: String,
    #[serde(default)]
    pub ordinal: i32,
    #[serde(default = "empty_object")]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ActivityActor {
    pub activity_id: String,
    pub actor_type: String,
    pub actor_id: String,
    pub role: String,
    pub metadata: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityActorUpsert {
    pub activity_id: String,
    pub actor_type: String,
    pub actor_id: String,
    pub role: String,
    #[serde(default = "empty_object")]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ResourceRevision {
    pub id: String,
    pub resource_id: String,
    pub revision: i32,
    pub parent_revision_id: Option<String>,
    pub content_sha256: Option<String>,
    pub metadata: Value,
    pub spec: Value,
    pub provenance: Value,
    pub created_by: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceRevisionCreate {
    pub id: String,
    pub resource_id: String,
    pub revision: i32,
    #[serde(default)]
    pub parent_revision_id: Option<String>,
    #[serde(default)]
    pub content_sha256: Option<String>,
    #[serde(default = "empty_object")]
    pub metadata: Value,
    #[serde(default = "empty_object")]
    pub spec: Value,
    #[serde(default = "empty_object")]
    pub provenance: Value,
    #[serde(default)]
    pub created_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct GraphAssociation {
    pub id: String,
    pub project_id: Option<String>,
    pub subject_id: String,
    pub predicate: String,
    pub object_id: String,
    pub qualifiers: Value,
    pub polarity: String,
    pub knowledge_level: String,
    pub status: String,
    pub scope: String,
    pub provenance: Value,
    pub created_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphAssociationUpsert {
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub subject_id: String,
    pub predicate: String,
    pub object_id: String,
    #[serde(default = "empty_object")]
    pub qualifiers: Value,
    #[serde(default = "neutral_polarity")]
    pub polarity: String,
    #[serde(default = "observation_level")]
    pub knowledge_level: String,
    #[serde(default = "proposed_status")]
    pub status: String,
    #[serde(default = "project_scope")]
    pub scope: String,
    #[serde(default = "empty_object")]
    pub provenance: Value,
    #[serde(default)]
    pub created_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct EvidenceItem {
    pub id: String,
    pub project_id: Option<String>,
    pub evidence_type: String,
    pub source_uri: Option<String>,
    pub source_id: Option<String>,
    pub locator: Value,
    pub statistics: Value,
    pub provenance: Value,
    pub created_by: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceItemCreate {
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub evidence_type: String,
    #[serde(default)]
    pub source_uri: Option<String>,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default = "empty_object")]
    pub locator: Value,
    #[serde(default = "empty_object")]
    pub statistics: Value,
    #[serde(default = "empty_object")]
    pub provenance: Value,
    #[serde(default)]
    pub created_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AssociationEvidence {
    pub association_id: String,
    pub evidence_id: String,
    pub stance: String,
    pub weight: Option<f64>,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssociationEvidenceUpsert {
    pub association_id: String,
    pub evidence_id: String,
    pub stance: String,
    #[serde(default)]
    pub weight: Option<f64>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProjectResourceBinding {
    pub project_id: String,
    pub resource_id: String,
    pub role: String,
    pub added_by: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectResourceBindingUpsert {
    pub project_id: String,
    pub resource_id: String,
    pub role: String,
    #[serde(default)]
    pub added_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ResourceGraphBinding {
    pub resource_id: String,
    pub entity_id: String,
    pub role: String,
    pub revision_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceGraphBindingUpsert {
    pub resource_id: String,
    pub entity_id: String,
    pub role: String,
    #[serde(default)]
    pub revision_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchSubgraph {
    pub root_entity_id: String,
    pub depth: u8,
    pub truncated: bool,
    pub entities: Vec<ResearchEntity>,
    pub associations: Vec<GraphAssociation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectContextPack {
    pub project: Project,
    pub studies: Vec<Study>,
    pub entities: Vec<ResearchEntity>,
    pub activities: Vec<Activity>,
    pub activity_io: Vec<ActivityIo>,
    pub activity_actors: Vec<ActivityActor>,
    pub associations: Vec<GraphAssociation>,
    pub evidence: Vec<EvidenceItem>,
    pub association_evidence: Vec<AssociationEvidence>,
    pub resources: Vec<Resource>,
    pub project_resources: Vec<ProjectResourceBinding>,
    pub resource_revisions: Vec<ResourceRevision>,
    pub resource_graph_bindings: Vec<ResourceGraphBinding>,
    pub truncated: bool,
}

fn private_visibility() -> String {
    "private".into()
}

fn active_status() -> String {
    "active".into()
}

fn planning_status() -> String {
    "planning".into()
}

fn planned_status() -> String {
    "planned".into()
}

fn proposed_status() -> String {
    "proposed".into()
}

fn generic_kind() -> String {
    "generic".into()
}

fn neutral_polarity() -> String {
    "neutral".into()
}

fn observation_level() -> String {
    "observation".into()
}

fn project_scope() -> String {
    "project".into()
}

fn empty_object() -> Value {
    Value::Object(serde_json::Map::new())
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
    #[serde(default, skip_serializing)]
    pub password: Option<String>,
    #[serde(default, skip_serializing, skip_deserializing)]
    pub password_hash: Option<String>,
    #[serde(default, skip_serializing)]
    pub totp_secret: Option<String>,
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
    #[serde(default, alias = "uncompressed_checksum")]
    pub canonical_checksum: Option<String>,
    #[serde(default)]
    pub uncompressed_size: Option<u64>,
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
            storage_backends: vec!["local", "s3", "clickhouse", "tiledb"],
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
    use super::{
        GraphAssociationUpsert, ProjectUpsert, ResourcePermissions, ResourceUpsert, Visibility,
        is_research_entity_category,
    };
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

    #[test]
    fn research_graph_defaults_are_stable_and_object_shaped() {
        let project: ProjectUpsert = serde_json::from_value(json!({
            "id":"project-1",
            "name":"Project 1"
        }))
        .unwrap();
        assert!(project.owner_user_id.is_empty());
        assert_eq!(project.visibility, "private");
        assert_eq!(project.status, "active");
        assert_eq!(project.metadata, json!({}));

        let association: GraphAssociationUpsert = serde_json::from_value(json!({
            "id":"association-1",
            "project_id":"project-1",
            "subject_id":"sample-1",
            "predicate":"derived_from",
            "object_id":"subject-1"
        }))
        .unwrap();
        assert_eq!(association.polarity, "neutral");
        assert_eq!(association.knowledge_level, "observation");
        assert_eq!(association.status, "proposed");
        assert_eq!(association.scope, "project");
        assert_eq!(association.qualifiers, json!({}));
    }

    #[test]
    fn research_entity_categories_include_structured_observations() {
        assert!(is_research_entity_category("subject"));
        assert!(is_research_entity_category("data_product"));
        assert!(is_research_entity_category("observation"));
        assert!(!is_research_entity_category("resource"));
    }
}
