use sha2::{Digest, Sha256};
use shennong_schema::{
    Artifact, ArtifactUpsert, AuditEvent, ProviderFile, ProviderManifest, Relation, RelationUpsert,
    Resource, ResourcePermissions, ResourceUpsert, User, UserUpsert,
};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Read},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
};
use thiserror::Error;
use tokio::{fs, io::AsyncWriteExt};
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
    #[error("provider file size verification failed")]
    Size,
    #[error("provider checksum verification failed")]
    Checksum,
    #[error("provider file definition is invalid")]
    InvalidFile,
    #[error("provider permissions are invalid")]
    InvalidPermissions,
    #[error("provider file processing failed: {0}")]
    Process(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

pub struct ProviderInstaller {
    provider_dir: PathBuf,
    data_root: PathBuf,
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
            data_root: data_root.into(),
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
        if manifest.files.is_empty() {
            return Err(ProviderError::InvalidFile);
        }
        let mut files = Vec::with_capacity(manifest.files.len());
        for file in &manifest.files {
            files.push((file, self.prepare_file(&manifest, file).await?));
        }
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
        let permissions = ResourcePermissions::from_value(&permissions)
            .map_err(|_| ProviderError::InvalidPermissions)?;
        let mut spec = manifest
            .resource_spec
            .as_object()
            .cloned()
            .unwrap_or_default();
        spec.insert("version".into(), manifest.version.clone().into());
        let resource = repository
            .upsert_resource(&ResourceUpsert {
                id: manifest.name.clone(),
                kind,
                metadata: metadata.into(),
                spec: spec.into(),
                status: "available".into(),
                provenance: serde_json::json!({"source": manifest.source, "version": manifest.version}),
                permissions,
            })
            .await?;
        for (file, path) in files {
            let mut schema = file.schema.as_object().cloned().unwrap_or_default();
            if file.index.as_deref() == Some("gene_matrix") {
                schema.insert(
                    "index_uri".into(),
                    format!("{}.idx.json", path.display()).into(),
                );
            }
            repository
                .upsert_artifact(&ArtifactUpsert {
                    id: file.id.clone(),
                    resource_id: resource.id.clone(),
                    uri: path.display().to_string(),
                    format: file.format.clone(),
                    size: Some(file.size as i64),
                    checksum: file.checksum.clone(),
                    storage_backend: "local".into(),
                    schema_json: schema.into(),
                    provenance: serde_json::json!({"source": manifest.source, "version": manifest.version, "download": file.download}),
                })
                .await?;
        }
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

    async fn prepare_file(
        &self,
        manifest: &ProviderManifest,
        file: &ProviderFile,
    ) -> Result<PathBuf, ProviderError> {
        if file.id.is_empty()
            || file.download_size > self.max_download_bytes as u64
            || Path::new(&file.filename)
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(ProviderError::InvalidFile);
        }
        let directory = self
            .data_root
            .join("resources")
            .join(&manifest.name)
            .join(&manifest.version);
        fs::create_dir_all(&directory).await?;
        let destination = directory.join(&file.filename);
        if fs::metadata(&destination)
            .await
            .is_ok_and(|metadata| metadata.len() == file.size)
        {
            self.ensure_index(file, &destination).await?;
            return Ok(destination);
        }
        let source = if file.compression.as_deref() == Some("gzip") {
            PathBuf::from(format!("{}.gz", destination.display()))
        } else {
            destination.clone()
        };
        self.download_to(&file.download, &source, file.download_size)
            .await?;
        if let Some(expected) = &file.checksum
            && hash_file(&source)?
                != expected
                    .strip_prefix("sha256:")
                    .unwrap_or(expected)
                    .to_lowercase()
        {
            return Err(ProviderError::Checksum);
        }
        if file.compression.as_deref() == Some("gzip") {
            decompress_gzip(source.clone(), destination.clone()).await?;
            fs::remove_file(source).await?;
        } else if file.compression.is_some() {
            return Err(ProviderError::UnsupportedSource);
        }
        if fs::metadata(&destination).await?.len() != file.size {
            return Err(ProviderError::Size);
        }
        self.ensure_index(file, &destination).await?;
        Ok(destination)
    }

    async fn download_to(
        &self,
        url: &str,
        destination: &Path,
        expected_size: u64,
    ) -> Result<(), ProviderError> {
        if !url.starts_with("https://") {
            return Err(ProviderError::UnsupportedSource);
        }
        if fs::metadata(destination)
            .await
            .is_ok_and(|metadata| metadata.len() == expected_size)
        {
            return Ok(());
        }
        let partial = PathBuf::from(format!("{}.part", destination.display()));
        let mut offset = fs::metadata(&partial)
            .await
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if offset > expected_size {
            fs::remove_file(&partial).await?;
            offset = 0;
        }
        let mut client = reqwest::Client::builder();
        if let Ok(proxy) = std::env::var("SHENNONG_DOWNLOAD_PROXY")
            && !proxy.is_empty()
        {
            client = client.proxy(reqwest::Proxy::all(proxy)?);
        }
        let client = client.build()?;
        let mut request = client.get(url);
        if offset > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={offset}-"));
        }
        let mut response = request.send().await?.error_for_status()?;
        let append = offset > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        if !append {
            offset = 0;
        }
        let mut output = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(&partial)
            .await?;
        let mut total = offset;
        while let Some(chunk) = response.chunk().await? {
            total += chunk.len() as u64;
            if total > expected_size || total > self.max_download_bytes as u64 {
                return Err(ProviderError::TooLarge);
            }
            output.write_all(&chunk).await?;
        }
        output.flush().await?;
        if total != expected_size {
            return Err(ProviderError::Size);
        }
        fs::rename(partial, destination).await?;
        Ok(())
    }

    async fn ensure_index(
        &self,
        file: &ProviderFile,
        destination: &Path,
    ) -> Result<(), ProviderError> {
        if file.index.as_deref() != Some("gene_matrix") {
            return Ok(());
        }
        let index = PathBuf::from(format!("{}.idx.json", destination.display()));
        if index.is_file() {
            return Ok(());
        }
        let source = destination.to_path_buf();
        tokio::task::spawn_blocking(move || build_gene_index(&source, &index))
            .await
            .map_err(|error| ProviderError::Process(error.to_string()))??;
        Ok(())
    }
}

fn hash_file(path: &Path) -> Result<String, ProviderError> {
    let mut file = std::fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

async fn decompress_gzip(source: PathBuf, destination: PathBuf) -> Result<(), ProviderError> {
    tokio::task::spawn_blocking(move || {
        let partial = PathBuf::from(format!("{}.part", destination.display()));
        let output = std::fs::File::create(&partial)?;
        let status = Command::new("gzip")
            .args(["-dc"])
            .arg(&source)
            .stdout(Stdio::from(output))
            .status()?;
        if !status.success() {
            return Err(ProviderError::Process("gzip returned an error".into()));
        }
        std::fs::rename(partial, destination)?;
        Ok(())
    })
    .await
    .map_err(|error| ProviderError::Process(error.to_string()))?
}

fn build_gene_index(source: &Path, destination: &Path) -> Result<(), ProviderError> {
    let mut reader = BufReader::new(std::fs::File::open(source)?);
    let mut line = String::new();
    let mut offset = reader.read_line(&mut line)? as u64;
    let mut offsets = BTreeMap::new();
    loop {
        line.clear();
        let count = reader.read_line(&mut line)?;
        if count == 0 {
            break;
        }
        if let Some(feature) = line.split('\t').next() {
            offsets.insert(feature.to_string(), offset);
        }
        offset += count as u64;
    }
    let partial = PathBuf::from(format!("{}.part", destination.display()));
    serde_json::to_writer(
        std::fs::File::create(&partial)?,
        &serde_json::json!({"offsets": offsets}),
    )?;
    std::fs::rename(partial, destination)?;
    Ok(())
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
        sqlx::query_as("SELECT id, kind, metadata, spec, status, provenance, permissions, created_at, updated_at FROM resources WHERE ($1::text IS NULL OR to_tsvector('simple', id || ' ' || kind || ' ' || metadata::text) @@ websearch_to_tsquery('simple', $1)) AND ($2 OR permissions->>'visibility' = 'public') ORDER BY id")
            .bind(search).bind(include_private).fetch_all(&self.pool).await
    }

    pub async fn get_resource(&self, id: &str) -> Result<Option<Resource>, sqlx::Error> {
        sqlx::query_as("SELECT id, kind, metadata, spec, status, provenance, permissions, created_at, updated_at FROM resources WHERE id = $1")
            .bind(id).fetch_optional(&self.pool).await
    }

    pub async fn upsert_resource(&self, value: &ResourceUpsert) -> Result<Resource, sqlx::Error> {
        sqlx::query_as("INSERT INTO resources (id, kind, metadata, spec, status, provenance, permissions) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, metadata = EXCLUDED.metadata, spec = EXCLUDED.spec, status = EXCLUDED.status, provenance = EXCLUDED.provenance, permissions = EXCLUDED.permissions, updated_at = NOW() RETURNING id, kind, metadata, spec, status, provenance, permissions, created_at, updated_at")
            .bind(&value.id).bind(&value.kind).bind(&value.metadata).bind(&value.spec).bind(&value.status).bind(&value.provenance).bind(value.permissions.as_value())
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
            "SELECT r.source, r.target, r.relation_type, r.evidence, r.provenance, r.created_at FROM relations r JOIN resources o ON o.id = CASE WHEN r.source = $1 THEN r.target ELSE r.source END WHERE (r.source = $1 OR r.target = $1) AND o.permissions->>'visibility' = 'public' ORDER BY r.relation_type, r.source, r.target"
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
    use super::{ProviderInstaller, build_gene_index};
    use std::env::temp_dir;
    use tokio::fs;
    use uuid::Uuid;

    #[tokio::test]
    async fn lists_curated_yaml_providers() {
        let directory = temp_dir().join(format!("shennong-providers-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).await.unwrap();
        fs::write(
            directory.join("toil.yaml"),
            "name: toil\nversion: 1\nsource: Xena\nfiles:\n  - id: expression\n    download: https://example.org/toil.tsv\n    filename: toil.tsv\n    format: tsv\n    download_size: 1\n    size: 1\n    checksum: null\n    compression: null\n    index: null\nresource_schema: {}\nresource_spec: {}\nstorage: {}\n",
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

    #[test]
    fn builds_gene_matrix_byte_offsets() {
        let directory = temp_dir().join(format!("shennong-index-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let matrix = directory.join("matrix.tsv");
        let index = directory.join("matrix.tsv.idx.json");
        std::fs::write(&matrix, "sample\tS1\nENSG1.1\t1\nENSG2.4\t2\n").unwrap();
        build_gene_index(&matrix, &index).unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&index).unwrap()).unwrap();
        assert_eq!(value["offsets"]["ENSG1.1"], 10);
        assert_eq!(value["offsets"]["ENSG2.4"], 20);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
