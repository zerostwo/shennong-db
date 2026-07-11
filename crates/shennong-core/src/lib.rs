use sha2::{Digest, Sha256};
use shennong_schema::{
    Artifact, ArtifactUpsert, AuditEvent, ProviderManifest, Relation, RelationUpsert, Resource,
    ResourceUpsert, User, UserUpsert,
};
use shennong_storage::{LocalObjectStorage, ObjectStorage, StorageError};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::path::{Path, PathBuf};
use thiserror::Error;
use tokio::fs;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("resource provider was not found")]
    NotFound,
    #[error("provider manifest is invalid: {0}")]
    Manifest(#[from] serde_yaml::Error),
    #[error("provider source is unsupported")]
    UnsupportedSource,
    #[error("provider download exceeds its configured size limit")]
    TooLarge,
    #[error("provider checksum verification failed")]
    Checksum,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

pub struct ProviderInstaller {
    provider_dir: PathBuf,
    storage: LocalObjectStorage,
    max_download_bytes: usize,
}

impl ProviderInstaller {
    pub fn new(
        provider_dir: impl Into<PathBuf>,
        data_root: impl Into<PathBuf>,
        max_download_bytes: usize,
    ) -> Self {
        Self {
            provider_dir: provider_dir.into(),
            storage: LocalObjectStorage::new(data_root),
            max_download_bytes,
        }
    }

    pub async fn install(
        &self,
        repository: &ResourceRepository,
        name: &str,
    ) -> Result<Resource, ProviderError> {
        if name.is_empty()
            || !name.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            })
        {
            return Err(ProviderError::NotFound);
        }
        let manifest = self.load(name).await?;
        let bytes = self.download(&manifest).await?;
        if let Some(expected) = &manifest.checksum {
            let actual = format!("{:x}", Sha256::digest(&bytes));
            if actual
                != expected
                    .strip_prefix("sha256:")
                    .unwrap_or(expected)
                    .to_lowercase()
            {
                return Err(ProviderError::Checksum);
            }
        }
        let filename = manifest
            .download
            .rsplit('/')
            .next()
            .and_then(|value| value.split('?').next())
            .filter(|value| !value.is_empty())
            .unwrap_or("resource.data");
        let uri = self
            .storage
            .write(
                &format!(
                    "resources/{}/{}/{}",
                    manifest.name, manifest.version, filename
                ),
                &bytes,
            )
            .await?;
        let mut metadata = serde_json::Map::new();
        metadata.insert("name".into(), manifest.name.clone().into());
        metadata.insert("source".into(), manifest.source.clone());
        if let Some(schema) = manifest.resource_schema.as_object() {
            metadata.extend(
                schema
                    .iter()
                    .filter(|(key, _)| key.as_str() != "kind")
                    .map(|(key, value)| (key.clone(), value.clone())),
            );
        }
        let kind = manifest
            .resource_schema
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("KnowledgeResource")
            .to_string();
        let permissions = manifest
            .storage
            .get("permissions")
            .cloned()
            .unwrap_or_else(shennong_schema::default_permissions);
        let resource = repository.upsert_resource(&ResourceUpsert {
            id: manifest.name.clone(), kind, metadata: metadata.into(),
            spec: serde_json::json!({"version": manifest.version, "storage": manifest.storage}),
            status: "available".into(), provenance: serde_json::json!({"source": manifest.source, "version": manifest.version}), permissions,
        }).await?;
        let format = Path::new(filename)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("binary")
            .to_string();
        repository.upsert_artifact(&ArtifactUpsert {
            id: format!("provider-{}-{}-data", manifest.name, manifest.version), resource_id: resource.id.clone(), uri,
            format, size: Some(bytes.len() as i64), checksum: manifest.checksum,
            storage_backend: manifest.storage.get("backend").and_then(serde_json::Value::as_str).unwrap_or("local").to_string(),
            schema_json: manifest.resource_schema, provenance: serde_json::json!({"source": manifest.source, "version": manifest.version}),
        }).await?;
        Ok(resource)
    }

    pub async fn list(&self) -> Result<Vec<ProviderManifest>, ProviderError> {
        let mut directory = match fs::read_dir(&self.provider_dir).await {
            Ok(directory) => directory,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(error) => return Err(error.into()),
        };
        let mut providers: Vec<ProviderManifest> = Vec::new();
        while let Some(entry) = directory.next_entry().await? {
            let path = entry.path();
            if matches!(
                path.extension().and_then(|extension| extension.to_str()),
                Some("yaml" | "yml")
            ) {
                providers.push(serde_yaml::from_str(&fs::read_to_string(path).await?)?);
            }
        }
        providers.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(providers)
    }

    async fn load(&self, name: &str) -> Result<ProviderManifest, ProviderError> {
        for extension in ["yaml", "yml"] {
            let path = self.provider_dir.join(format!("{name}.{extension}"));
            if path.is_file() {
                return Ok(serde_yaml::from_str(&fs::read_to_string(path).await?)?);
            }
        }
        Err(ProviderError::NotFound)
    }

    async fn download(&self, manifest: &ProviderManifest) -> Result<Vec<u8>, ProviderError> {
        if manifest.download.starts_with("http://") || manifest.download.starts_with("https://") {
            let response = reqwest::get(&manifest.download).await?.error_for_status()?;
            if response
                .content_length()
                .is_some_and(|size| size > self.max_download_bytes as u64)
            {
                return Err(ProviderError::TooLarge);
            }
            let data = response.bytes().await?.to_vec();
            if data.len() > self.max_download_bytes {
                return Err(ProviderError::TooLarge);
            }
            return Ok(data);
        }
        let data = fs::read(&manifest.download).await?;
        if data.len() > self.max_download_bytes {
            return Err(ProviderError::TooLarge);
        }
        Ok(data)
    }
}

pub struct ResourceRepository {
    pool: PgPool,
}

impl ResourceRepository {
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        Ok(Self {
            pool: PgPoolOptions::new()
                .max_connections(10)
                .connect(database_url)
                .await?,
        })
    }

    pub async fn migrate(&self) -> Result<(), sqlx::migrate::MigrateError> {
        sqlx::migrate!("./migrations").run(&self.pool).await
    }

    pub async fn is_ready(&self) -> Result<bool, sqlx::Error> {
        Ok(sqlx::query_scalar::<_, i32>("SELECT 1")
            .fetch_one(&self.pool)
            .await?
            == 1)
    }

    pub async fn list_resources(
        &self,
        search: Option<&str>,
        include_private: bool,
    ) -> Result<Vec<Resource>, sqlx::Error> {
        sqlx::query_as("SELECT id, kind, metadata, spec, status, provenance, permissions, created_at, updated_at FROM resources WHERE ($1::text IS NULL OR to_tsvector('simple', id || ' ' || kind || ' ' || metadata::text) @@ websearch_to_tsquery('simple', $1)) AND ($2 OR permissions->>'visibility' != 'private') ORDER BY id")
            .bind(search).bind(include_private).fetch_all(&self.pool).await
    }

    pub async fn get_resource(&self, id: &str) -> Result<Option<Resource>, sqlx::Error> {
        sqlx::query_as("SELECT id, kind, metadata, spec, status, provenance, permissions, created_at, updated_at FROM resources WHERE id = $1")
            .bind(id).fetch_optional(&self.pool).await
    }

    pub async fn upsert_resource(&self, value: &ResourceUpsert) -> Result<Resource, sqlx::Error> {
        sqlx::query_as("INSERT INTO resources (id, kind, metadata, spec, status, provenance, permissions) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, metadata = EXCLUDED.metadata, spec = EXCLUDED.spec, status = EXCLUDED.status, provenance = EXCLUDED.provenance, permissions = EXCLUDED.permissions, updated_at = NOW() RETURNING id, kind, metadata, spec, status, provenance, permissions, created_at, updated_at")
            .bind(&value.id).bind(&value.kind).bind(&value.metadata).bind(&value.spec).bind(&value.status).bind(&value.provenance).bind(&value.permissions)
            .fetch_one(&self.pool).await
    }

    pub async fn list_artifacts(&self, resource_id: &str) -> Result<Vec<Artifact>, sqlx::Error> {
        sqlx::query_as("SELECT id, resource_id, uri, format, size, checksum, storage_backend, schema_json, provenance, created_at FROM artifacts WHERE resource_id = $1 ORDER BY id")
            .bind(resource_id).fetch_all(&self.pool).await
    }

    pub async fn get_artifact(&self, id: &str) -> Result<Option<Artifact>, sqlx::Error> {
        sqlx::query_as("SELECT id, resource_id, uri, format, size, checksum, storage_backend, schema_json, provenance, created_at FROM artifacts WHERE id = $1")
            .bind(id).fetch_optional(&self.pool).await
    }

    pub async fn upsert_artifact(&self, value: &ArtifactUpsert) -> Result<Artifact, sqlx::Error> {
        sqlx::query_as("INSERT INTO artifacts (id, resource_id, uri, format, size, checksum, storage_backend, schema_json, provenance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO UPDATE SET resource_id = EXCLUDED.resource_id, uri = EXCLUDED.uri, format = EXCLUDED.format, size = EXCLUDED.size, checksum = EXCLUDED.checksum, storage_backend = EXCLUDED.storage_backend, schema_json = EXCLUDED.schema_json, provenance = EXCLUDED.provenance RETURNING id, resource_id, uri, format, size, checksum, storage_backend, schema_json, provenance, created_at")
            .bind(&value.id).bind(&value.resource_id).bind(&value.uri).bind(&value.format).bind(value.size).bind(&value.checksum).bind(&value.storage_backend).bind(&value.schema_json).bind(&value.provenance)
            .fetch_one(&self.pool).await
    }

    pub async fn list_relations(
        &self,
        resource_id: &str,
        include_private: bool,
    ) -> Result<Vec<Relation>, sqlx::Error> {
        let query = if include_private {
            "SELECT source, target, relation_type, evidence, provenance, created_at FROM relations WHERE source = $1 OR target = $1 ORDER BY relation_type, source, target"
        } else {
            "SELECT r.source, r.target, r.relation_type, r.evidence, r.provenance, r.created_at FROM relations r JOIN resources o ON o.id = CASE WHEN r.source = $1 THEN r.target ELSE r.source END WHERE (r.source = $1 OR r.target = $1) AND o.permissions->>'visibility' != 'private' ORDER BY r.relation_type, r.source, r.target"
        };
        sqlx::query_as(query)
            .bind(resource_id)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn upsert_relation(&self, value: &RelationUpsert) -> Result<Relation, sqlx::Error> {
        sqlx::query_as("INSERT INTO relations (source, target, relation_type, evidence, provenance) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (source, target, relation_type) DO UPDATE SET evidence = EXCLUDED.evidence, provenance = EXCLUDED.provenance RETURNING source, target, relation_type, evidence, provenance, created_at")
            .bind(&value.source).bind(&value.target).bind(&value.relation_type).bind(&value.evidence).bind(&value.provenance)
            .fetch_one(&self.pool).await
    }

    pub async fn grant_resource(
        &self,
        resource_id: &str,
        user_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO resource_grants (resource_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(resource_id).bind(user_id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn list_users(&self) -> Result<Vec<User>, sqlx::Error> {
        sqlx::query_as("SELECT id, display_name, email, role, status, created_at, updated_at FROM users ORDER BY id")
            .fetch_all(&self.pool)
            .await
    }

    pub async fn get_user(&self, id: &str) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as("SELECT id, display_name, email, role, status, created_at, updated_at FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn upsert_user(&self, value: &UserUpsert) -> Result<User, sqlx::Error> {
        sqlx::query_as("INSERT INTO users (id, display_name, email, role, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, role = EXCLUDED.role, status = EXCLUDED.status, updated_at = NOW() RETURNING id, display_name, email, role, status, created_at, updated_at")
            .bind(&value.id)
            .bind(&value.display_name)
            .bind(&value.email)
            .bind(&value.role)
            .bind(&value.status)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn can_read_resource(
        &self,
        resource_id: &str,
        user_id: &str,
    ) -> Result<bool, sqlx::Error> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM resource_grants WHERE resource_id = $1 AND user_id = $2)",
        )
        .bind(resource_id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn record_audit_event(
        &self,
        actor_user_id: Option<&str>,
        action: &str,
        resource_type: &str,
        resource_id: &str,
        metadata: &serde_json::Value,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO audit_events (event_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)")
            .bind(Uuid::new_v4().to_string()).bind(actor_user_id).bind(action).bind(resource_type).bind(resource_id).bind(metadata)
            .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn list_audit_events(&self, limit: i64) -> Result<Vec<AuditEvent>, sqlx::Error> {
        sqlx::query_as("SELECT event_id, actor_user_id, action, resource_type, resource_id, metadata, created_at FROM audit_events ORDER BY created_at DESC LIMIT $1")
            .bind(limit).fetch_all(&self.pool).await
    }
}

#[cfg(test)]
mod tests {
    use super::ProviderInstaller;
    use std::env::temp_dir;
    use tokio::fs;
    use uuid::Uuid;

    #[tokio::test]
    async fn lists_curated_yaml_providers() {
        let directory = temp_dir().join(format!("shennong-providers-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).await.unwrap();
        fs::write(
            directory.join("toil.yaml"),
            "name: toil\nversion: 1\nsource: Xena\ndownload: /tmp/toil.tsv\nresource_schema: {}\nstorage: {}\n",
        )
        .await
        .unwrap();
        let providers = ProviderInstaller::new(&directory, temp_dir(), 1)
            .list()
            .await
            .unwrap();
        fs::remove_dir_all(&directory).await.unwrap();
        assert_eq!(providers[0].name, "toil");
        assert_eq!(providers[0].version, "1");
    }
}
