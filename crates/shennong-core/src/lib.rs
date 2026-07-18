use sha2::{Digest, Sha256};
use shennong_schema::{
    Artifact, ArtifactUpsert, AuditEvent, ProviderFile, ProviderManifest, Relation, RelationUpsert,
    Resource, ResourcePermissions, ResourceUpsert, User, UserUpsert,
};
use shennong_storage::{ArtifactUri, BlobStore, LocalObjectStorage, ObjectKey};
use sqlx::{PgPool, Postgres, Transaction, postgres::PgPoolOptions};
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Read},
    path::{Component, Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use thiserror::Error;
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    time::timeout,
};
use uuid::Uuid;

mod agent;
mod agent_context;
mod research_graph;
mod web;
pub use agent::ModelProviderRecord;
pub use research_graph::{MAX_RESEARCH_GRAPH_DEPTH, MAX_RESEARCH_GRAPH_LIMIT};
pub use web::{LoginEventWrite, UploadWrite, UsageEventWrite};

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
    #[error("provider staging area does not have enough free space")]
    DiskSpace,
    #[error("provider checksum verification failed")]
    Checksum,
    #[error("provider checksum is required in production mode")]
    IntegrityRequired,
    #[error("provider operation timed out")]
    Timeout,
    #[error("provider file definition is invalid")]
    InvalidFile,
    #[error("provider permissions are invalid")]
    InvalidPermissions,
    #[error("provider installation is already in progress")]
    Busy,
    #[error("provider ingestion state is invalid")]
    InvalidState,
    #[error("an available resource requires at least one artifact")]
    MissingArtifact,
    #[error("provider file processing failed: {0}")]
    Process(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Storage(#[from] shennong_storage::StorageError),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct IngestionJob {
    pub id: String,
    pub provider_name: String,
    pub provider_version: String,
    pub resource_id: String,
    pub status: String,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UserCredentials {
    pub id: String,
    pub display_name: String,
    pub email: Option<String>,
    pub role: String,
    pub status: String,
    pub password_hash: Option<String>,
    pub totp_secret: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AccessToken {
    pub token_hash: String,
    pub user_id: String,
    pub issued_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub revoked_at: Option<chrono::DateTime<chrono::Utc>>,
    pub scopes: serde_json::Value,
}

enum IngestionStart {
    Available(Resource),
    Started(IngestionJob),
}

pub struct ProviderInstaller {
    provider_dir: PathBuf,
    data_root: PathBuf,
    max_download_bytes: usize,
    download_timeout: Duration,
    allow_unverified: bool,
    storage: std::sync::Arc<dyn BlobStore>,
    remote_storage: Option<std::sync::Arc<dyn BlobStore>>,
}

struct PreparedFile {
    file: ProviderFile,
    raw_path: PathBuf,
    raw_checksum: String,
    canonical_checksum: String,
    fetched_at: String,
    index_path: Option<PathBuf>,
}

impl ProviderInstaller {
    pub fn new(
        provider_dir: impl Into<PathBuf>,
        data_root: impl Into<PathBuf>,
        max_download_bytes: usize,
    ) -> Self {
        let data_root = data_root.into();
        Self {
            provider_dir: provider_dir.into(),
            data_root: data_root.clone(),
            max_download_bytes,
            download_timeout: env_duration(
                "SHENNONG_PROVIDER_INSTALL_TIMEOUT_SECS",
                env_duration("SHENNONG_DOWNLOAD_TIMEOUT_SECS", 14_400).as_secs(),
            ),
            allow_unverified: std::env::var("SHENNONG_PROVIDER_ALLOW_UNVERIFIED")
                .is_ok_and(|value| matches!(value.as_str(), "1" | "true" | "yes")),
            storage: std::sync::Arc::new(LocalObjectStorage::new(data_root)),
            remote_storage: None,
        }
    }

    pub fn with_remote_storage(mut self, storage: std::sync::Arc<dyn BlobStore>) -> Self {
        self.remote_storage = Some(storage);
        self
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
        let job = match repository
            .start_ingestion(&manifest.name, &manifest.version, &manifest.name)
            .await?
        {
            IngestionStart::Available(resource) => return Ok(resource),
            IngestionStart::Started(job) => job,
        };
        let staging = self
            .data_root
            .join("resources")
            .join(".staging")
            .join(&job.id);
        let final_directory = self
            .data_root
            .join("resources")
            .join(&manifest.name)
            .join(&manifest.version);
        let result = self
            .install_staged(repository, &manifest, &job, &staging, &final_directory)
            .await;
        match result {
            Ok(resource) => Ok(resource),
            Err(error) => {
                let _ = fs::remove_dir_all(&staging).await;
                let _ = repository.fail_ingestion(&job.id, error.code()).await;
                Err(error)
            }
        }
    }

    async fn install_staged(
        &self,
        repository: &ResourceRepository,
        manifest: &ProviderManifest,
        job: &IngestionJob,
        staging: &Path,
        final_directory: &Path,
    ) -> Result<Resource, ProviderError> {
        if fs::try_exists(final_directory).await? {
            return Err(ProviderError::InvalidState);
        }
        fs::create_dir_all(staging).await?;
        repository
            .transition_ingestion(&job.id, "downloading")
            .await?;
        for file in &manifest.files {
            self.validate_file(file)?;
        }
        let mut files = Vec::with_capacity(manifest.files.len());
        for file in &manifest.files {
            ensure_disk_space(staging, file.download_size.saturating_add(file.size))?;
            files.push(self.prepare_file(file, staging).await?);
        }
        repository
            .transition_ingestion(&job.id, "verifying")
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
        let permissions = ResourcePermissions::from_value(&permissions)
            .map_err(|_| ProviderError::InvalidPermissions)?;
        let mut spec = manifest
            .resource_spec
            .as_object()
            .cloned()
            .unwrap_or_default();
        spec.insert("version".into(), manifest.version.clone().into());
        let resource = ResourceUpsert {
            id: manifest.name.clone(),
            kind,
            metadata: metadata.into(),
            spec: spec.into(),
            status: "available".into(),
            provenance: serde_json::json!({"source": manifest.source, "version": manifest.version}),
            permissions,
        };
        let mut artifacts = Vec::with_capacity(files.len());
        for prepared in files {
            let file = prepared.file;
            let mut schema = file.schema.as_object().cloned().unwrap_or_default();
            let path = final_directory.join(&file.filename);
            if file.index.as_deref() == Some("gene_matrix") {
                schema.insert(
                    "index_uri".into(),
                    format!("{}.idx.json", path.display()).into(),
                );
            }
            let raw_name = prepared
                .raw_path
                .file_name()
                .ok_or(ProviderError::InvalidFile)?;
            let raw_relative = PathBuf::from("raw")
                .join(&prepared.raw_checksum)
                .join(raw_name);
            let raw_staging = staging.join(&raw_relative);
            if let Some(parent) = raw_staging.parent() {
                fs::create_dir_all(parent).await?;
            }
            fs::copy(&prepared.raw_path, &raw_staging).await?;
            let raw_path = final_directory.join(&raw_relative);
            let raw_artifact_id = format!("raw-{}", prepared.raw_checksum);
            let integrity_status = if file.checksum.is_some() {
                "verified"
            } else {
                "unverified"
            };
            artifacts.push(ArtifactUpsert {
                id: raw_artifact_id.clone(),
                resource_id: resource.id.clone(),
                uri: raw_path.display().to_string(),
                format: file.format.clone(),
                size: Some(file.download_size as i64),
                checksum: Some(prepared.raw_checksum.clone()),
                storage_backend: "local".into(),
                data_class: "raw".into(),
                immutable: true,
                content_sha256: Some(prepared.raw_checksum.clone()),
                source_uri: Some(file.download.clone()),
                derived_from: serde_json::json!([]),
                pipeline_version: None,
                retention_policy: Some("retain".into()),
                storage_uri: Some(raw_path.display().to_string()),
                schema_json: serde_json::json!({"role": "raw", "compression": file.compression}),
                provenance: serde_json::json!({
                    "source": manifest.source,
                    "version": manifest.version,
                    "download": file.download,
                "fetched_at": prepared.fetched_at.clone(),
                    "integrity_status": integrity_status,
                    "canonical_artifact_id": file.id,
                }),
            });
            artifacts.push(ArtifactUpsert {
                id: file.id.clone(),
                resource_id: resource.id.clone(),
                uri: path.display().to_string(),
                format: file.format.clone(),
                size: Some(file.size as i64),
                checksum: Some(prepared.canonical_checksum.clone()),
                storage_backend: "local".into(),
                data_class: "canonical".into(),
                immutable: true,
                content_sha256: Some(prepared.canonical_checksum.clone()),
                source_uri: Some(raw_path.display().to_string()),
                derived_from: serde_json::json!([raw_artifact_id]),
                pipeline_version: Some("provider-canonical-v1".into()),
                retention_policy: Some("retain".into()),
                storage_uri: Some(path.display().to_string()),
                schema_json: schema.into(),
                provenance: serde_json::json!({
                    "source": manifest.source,
                    "version": manifest.version,
                    "download": file.download,
                    "fetched_at": prepared.fetched_at,
                    "integrity_status": integrity_status,
                    "raw_checksum": prepared.raw_checksum,
                    "canonical_checksum": prepared.canonical_checksum,
                    "raw_artifact_id": format!("raw-{}", prepared.raw_checksum),
                }),
            });
            if let Some(index_path) = prepared.index_path {
                let relative = index_path.strip_prefix(staging).unwrap_or(&index_path);
                let staged_index = staging.join(relative);
                let index_path = final_directory.join(relative);
                let index_checksum = hash_file(&staged_index)?;
                artifacts.push(ArtifactUpsert {
                    id: format!("{}-index", file.id),
                    resource_id: resource.id.clone(),
                    uri: index_path.display().to_string(),
                    format: "json".into(),
                    size: Some(
                        self.storage
                            .head(
                                &ArtifactUri::parse(&staged_index.to_string_lossy())
                                    .map_err(|_| ProviderError::MissingArtifact)?,
                            )
                            .await
                            .map_err(|_| ProviderError::MissingArtifact)?
                            .size as i64,
                    ),
                    checksum: Some(index_checksum.clone()),
                    storage_backend: "local".into(),
                    data_class: "derived".into(),
                    immutable: true,
                    content_sha256: Some(index_checksum),
                    source_uri: Some(path.display().to_string()),
                    derived_from: serde_json::json!([file.id]),
                    pipeline_version: Some("gene-index-v1".into()),
                    retention_policy: Some("rebuildable".into()),
                    storage_uri: Some(index_path.display().to_string()),
                    schema_json: serde_json::json!({"role": "gene_index", "artifact_id": file.id}),
                    provenance: serde_json::json!({
                        "derived_from": file.id,
                        "integrity_status": "verified",
                    }),
                });
            }
        }
        repository
            .transition_ingestion(&job.id, "materializing")
            .await?;
        if let Some(parent) = final_directory.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::rename(staging, final_directory).await?;
        match self
            .run_materializer(&manifest.storage, &resource, final_directory, &artifacts)
            .await
        {
            Ok(Some(derived)) => artifacts.push(derived),
            Ok(None) => {}
            Err(error) => {
                let _ = fs::remove_dir_all(&final_directory).await;
                return Err(error);
            }
        }
        if let Some(storage) = &self.remote_storage {
            let mut uri_map = Vec::new();
            for artifact in &mut artifacts {
                if artifact.storage_backend != "local" {
                    continue;
                }
                let source = PathBuf::from(&artifact.uri);
                let relative = source
                    .strip_prefix(final_directory)
                    .map_err(|_| ProviderError::MissingArtifact)?;
                let key = ObjectKey::new(&format!(
                    "resources/{}/{}/{}",
                    manifest.name,
                    manifest.version,
                    relative.to_string_lossy()
                ))?;
                let mut reader = fs::File::open(&source).await?;
                let uri = storage.put_stream(&key, &mut reader).await?;
                uri_map.push((artifact.uri.clone(), uri.to_string()));
                artifact.uri = uri.to_string();
                artifact.storage_uri = Some(artifact.uri.clone());
                artifact.storage_backend = "s3".into();
            }
            for artifact in &mut artifacts {
                if let Some(index_uri) = artifact.schema_json.get_mut("index_uri")
                    && let Some((_, remote)) = uri_map
                        .iter()
                        .find(|(local, _)| index_uri.as_str() == Some(local))
                {
                    *index_uri = remote.clone().into();
                }
            }
        }
        let result = repository
            .publish_ingestion(&job.id, &resource, &artifacts)
            .await
            .map_err(ProviderError::Database);
        if result.is_err() || self.remote_storage.is_some() {
            let _ = fs::remove_dir_all(final_directory).await;
            if let Some(parent) = final_directory.parent() {
                let _ = fs::remove_dir(parent).await;
            }
        }
        result
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
        file: &ProviderFile,
        directory: &Path,
    ) -> Result<PreparedFile, ProviderError> {
        let destination = directory.join(&file.filename);
        let source = if file.compression.as_deref() == Some("gzip") {
            PathBuf::from(format!("{}.gz", destination.display()))
        } else {
            destination.clone()
        };
        let raw_checksum = self
            .download_to(
                &file.download,
                &source,
                file.download_size,
                file.checksum.as_deref(),
            )
            .await?;
        let fetched_at = chrono::Utc::now().to_rfc3339();
        let canonical_checksum = if file.compression.as_deref() == Some("gzip") {
            decompress_gzip(
                source.clone(),
                destination.clone(),
                file.size,
                self.max_download_bytes as u64,
                self.download_timeout,
            )
            .await?
        } else {
            raw_checksum.clone()
        };
        if let Some(expected) = &file.canonical_checksum {
            verify_checksum(&canonical_checksum, expected)?;
        }
        if file.compression.is_some() && file.compression.as_deref() != Some("gzip") {
            return Err(ProviderError::UnsupportedSource);
        }
        if fs::metadata(&destination).await?.len() != file.size {
            return Err(ProviderError::Size);
        }
        let index_path = self
            .ensure_index(file, &destination, &canonical_checksum)
            .await?;
        Ok(PreparedFile {
            file: file.clone(),
            raw_path: source,
            raw_checksum,
            canonical_checksum,
            fetched_at,
            index_path,
        })
    }

    async fn run_materializer(
        &self,
        storage: &serde_json::Value,
        resource: &ResourceUpsert,
        final_directory: &Path,
        artifacts: &[ArtifactUpsert],
    ) -> Result<Option<ArtifactUpsert>, ProviderError> {
        let Some(materializer) = storage
            .get("materializer")
            .and_then(serde_json::Value::as_object)
        else {
            return Ok(None);
        };
        let command = materializer
            .get("command")
            .and_then(serde_json::Value::as_str)
            .ok_or(ProviderError::InvalidFile)?;
        let source_file = materializer
            .get("source_file")
            .and_then(serde_json::Value::as_str)
            .ok_or(ProviderError::InvalidFile)?;
        let target = materializer
            .get("target")
            .and_then(serde_json::Value::as_str)
            .ok_or(ProviderError::InvalidFile)?;
        let source = final_directory.join(source_file);
        let target = final_directory.join(target);
        if Path::new(source_file)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
            || Path::new(target.strip_prefix(final_directory).unwrap_or(&target))
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err(ProviderError::InvalidFile);
        }
        let python = materializer
            .get("python")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("python3");
        let output = timeout(
            self.download_timeout,
            Command::new(python)
                .arg(command)
                .args(["ingest", "--source"])
                .arg(&source)
                .args(["--uri"])
                .arg(&target)
                .output(),
        )
        .await
        .map_err(|_| ProviderError::Timeout)??;
        if !output.status.success() {
            return Err(ProviderError::Process("materializer failed".into()));
        }
        if !fs::try_exists(&target).await? {
            return Err(ProviderError::MissingArtifact);
        }
        let source_artifact = artifacts
            .iter()
            .find(|artifact| artifact.uri.ends_with(source_file))
            .ok_or(ProviderError::MissingArtifact)?;
        let id = materializer
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("materialized");
        Ok(Some(ArtifactUpsert {
            id: format!("{}-{id}", resource.id),
            resource_id: resource.id.clone(),
            uri: target.display().to_string(),
            format: materializer
                .get("format")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("tiledb")
                .into(),
            size: None,
            checksum: None,
            storage_backend: materializer
                .get("storage_backend")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("tiledb")
                .into(),
            data_class: "derived".into(),
            immutable: true,
            content_sha256: None,
            source_uri: Some(source_artifact.uri.clone()),
            derived_from: serde_json::json!([source_artifact.id]),
            pipeline_version: materializer
                .get("version")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
            retention_policy: Some("rebuildable".into()),
            storage_uri: Some(target.display().to_string()),
            schema_json: materializer
                .get("schema")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({"role":"materialized"})),
            provenance: serde_json::json!({
                "materializer": command,
                "version": materializer.get("version"),
                "derived_from": source_artifact.id,
            }),
        }))
    }

    fn validate_file(&self, file: &ProviderFile) -> Result<(), ProviderError> {
        if file.id.is_empty()
            || file.download_size == 0
            || file.size == 0
            || file.download_size > self.max_download_bytes as u64
            || Path::new(&file.filename)
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(ProviderError::InvalidFile);
        }
        if file.checksum.is_none() && !self.allow_unverified {
            return Err(ProviderError::IntegrityRequired);
        }
        if let Some(checksum) = &file.checksum {
            validate_checksum(checksum)?;
        }
        if let Some(checksum) = &file.canonical_checksum {
            validate_checksum(checksum)?;
        }
        if file.uncompressed_size.is_some_and(|size| size != file.size) {
            return Err(ProviderError::Size);
        }
        if file
            .compression
            .as_deref()
            .is_some_and(|value| value != "gzip")
        {
            return Err(ProviderError::UnsupportedSource);
        }
        Ok(())
    }

    async fn download_to(
        &self,
        url: &str,
        destination: &Path,
        expected_size: u64,
        expected_checksum: Option<&str>,
    ) -> Result<String, ProviderError> {
        if !url.starts_with("https://") {
            return Err(ProviderError::UnsupportedSource);
        }
        if fs::metadata(destination)
            .await
            .is_ok_and(|metadata| metadata.len() == expected_size)
        {
            let checksum = hash_file_async(destination).await?;
            if let Some(expected) = expected_checksum {
                verify_checksum(&checksum, expected)?;
            }
            return Ok(checksum);
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
        let client = client.timeout(self.download_timeout).build()?;
        loop {
            let mut request = client.get(url);
            if offset > 0 {
                request = request.header(reqwest::header::RANGE, format!("bytes={offset}-"));
            }
            let mut response = request.send().await?;
            if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && offset > 0 {
                fs::remove_file(&partial).await?;
                offset = 0;
                continue;
            }
            if !response.status().is_success() {
                return Err(ProviderError::Http(
                    response.error_for_status().unwrap_err(),
                ));
            }
            let append = offset > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
            if let Some(content_length) = response.content_length() {
                let expected_response_size = if append {
                    expected_size - offset
                } else {
                    expected_size
                };
                if content_length != expected_response_size {
                    let _ = fs::remove_file(&partial).await;
                    return Err(ProviderError::Size);
                }
            }
            if append {
                let valid_range = response
                    .headers()
                    .get(reqwest::header::CONTENT_RANGE)
                    .and_then(|value| value.to_str().ok())
                    .is_some_and(|value| value.starts_with(&format!("bytes {offset}-")));
                if !valid_range {
                    let _ = fs::remove_file(&partial).await;
                    return Err(ProviderError::Size);
                }
            } else {
                offset = 0;
            }
            let mut digest = if append {
                digest_file_async(&partial).await?
            } else {
                Sha256::new()
            };
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
                    let _ = fs::remove_file(&partial).await;
                    return Err(ProviderError::TooLarge);
                }
                digest.update(&chunk);
                output.write_all(&chunk).await?;
            }
            output.flush().await?;
            output.sync_all().await?;
            if total != expected_size {
                return Err(ProviderError::Size);
            }
            let checksum = format!("{:x}", digest.finalize());
            if let Some(expected) = expected_checksum {
                verify_checksum(&checksum, expected)?;
            }
            fs::rename(&partial, destination).await?;
            return Ok(checksum);
        }
    }

    async fn ensure_index(
        &self,
        file: &ProviderFile,
        destination: &Path,
        canonical_checksum: &str,
    ) -> Result<Option<PathBuf>, ProviderError> {
        if file.index.as_deref() != Some("gene_matrix") {
            return Ok(None);
        }
        let index = PathBuf::from(format!("{}.idx.json", destination.display()));
        if index.is_file() {
            let valid = std::fs::read_to_string(&index)
                .ok()
                .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
                .is_some_and(|value| {
                    value["schema_version"] == 2
                        && value["matrix_sha256"].as_str() == Some(canonical_checksum)
                });
            if valid {
                return Ok(Some(index));
            }
        }
        let source = destination.to_path_buf();
        let output = index.clone();
        let checksum = canonical_checksum.to_owned();
        tokio::task::spawn_blocking(move || {
            build_gene_index_with_checksum(&source, &output, &checksum)
        })
        .await
        .map_err(|error| ProviderError::Process(error.to_string()))??;
        Ok(Some(index))
    }
}

impl ProviderError {
    fn code(&self) -> &'static str {
        match self {
            Self::NotFound => "provider_not_found",
            Self::Manifest(_) => "provider_manifest_invalid",
            Self::UnsupportedSource => "provider_source_unsupported",
            Self::TooLarge => "provider_download_too_large",
            Self::Size => "provider_size_mismatch",
            Self::DiskSpace => "provider_disk_space",
            Self::Checksum => "provider_checksum_mismatch",
            Self::IntegrityRequired => "provider_integrity_required",
            Self::Timeout => "provider_timeout",
            Self::InvalidFile => "provider_file_invalid",
            Self::InvalidPermissions => "provider_permissions_invalid",
            Self::Busy => "provider_busy",
            Self::InvalidState => "provider_state_invalid",
            Self::MissingArtifact => "provider_artifact_missing",
            Self::Process(_) => "provider_materialization_failed",
            Self::Io(_) => "provider_io_failed",
            Self::Json(_) => "provider_json_invalid",
            Self::Http(_) => "provider_http_failed",
            Self::Storage(_) => "provider_storage_failed",
            Self::Database(_) => "provider_database_failed",
        }
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

async fn hash_file_async(path: &Path) -> Result<String, ProviderError> {
    Ok(format!("{:x}", digest_file_async(path).await?.finalize()))
}

async fn digest_file_async(path: &Path) -> Result<Sha256, ProviderError> {
    let mut input = fs::File::open(path).await?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let count = input.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(digest)
}

async fn decompress_gzip(
    source: PathBuf,
    destination: PathBuf,
    expected_size: u64,
    max_size: u64,
    operation_timeout: Duration,
) -> Result<String, ProviderError> {
    let partial = PathBuf::from(format!("{}.part", destination.display()));
    let mut child = Command::new("gzip")
        .args(["-dc"])
        .arg(&source)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| ProviderError::Process("gzip stdout was unavailable".into()))?;
    let mut output = fs::File::create(&partial).await?;
    let mut digest = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let count = timeout(operation_timeout, stdout.read(&mut buffer))
            .await
            .map_err(|_| ProviderError::Timeout)??;
        if count == 0 {
            break;
        }
        total = total.saturating_add(count as u64);
        if total > expected_size || total > max_size {
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = fs::remove_file(&partial).await;
            return Err(ProviderError::TooLarge);
        }
        digest.update(&buffer[..count]);
        output.write_all(&buffer[..count]).await?;
    }
    let status = timeout(operation_timeout, child.wait())
        .await
        .map_err(|_| ProviderError::Timeout)??;
    if !status.success() {
        let _ = fs::remove_file(&partial).await;
        return Err(ProviderError::Process("gzip returned an error".into()));
    }
    output.flush().await?;
    output.sync_all().await?;
    if total != expected_size {
        let _ = fs::remove_file(&partial).await;
        return Err(ProviderError::Size);
    }
    fs::rename(&partial, destination).await?;
    Ok(format!("{:x}", digest.finalize()))
}

fn validate_checksum(checksum: &str) -> Result<(), ProviderError> {
    let value = checksum.strip_prefix("sha256:").unwrap_or(checksum);
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ProviderError::Checksum);
    }
    Ok(())
}

fn verify_checksum(actual: &str, expected: &str) -> Result<(), ProviderError> {
    validate_checksum(expected)?;
    let expected = expected
        .strip_prefix("sha256:")
        .unwrap_or(expected)
        .to_ascii_lowercase();
    if actual != expected {
        return Err(ProviderError::Checksum);
    }
    Ok(())
}

fn env_duration(name: &str, default_seconds: u64) -> Duration {
    Duration::from_secs(
        std::env::var(name)
            .ok()
            .and_then(|value| value.parse().ok())
            .filter(|value: &u64| *value > 0)
            .unwrap_or(default_seconds),
    )
}

fn ensure_disk_space(path: &Path, required: u64) -> Result<(), ProviderError> {
    #[cfg(unix)]
    {
        use std::{ffi::CString, mem::MaybeUninit, os::unix::ffi::OsStrExt};
        let path =
            CString::new(path.as_os_str().as_bytes()).map_err(|_| ProviderError::DiskSpace)?;
        let mut stats = MaybeUninit::<libc::statvfs>::uninit();
        // SAFETY: path is NUL-terminated and stats points to writable storage.
        let result = unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) };
        if result != 0 {
            return Err(ProviderError::DiskSpace);
        }
        // SAFETY: statvfs initialized stats when it returned success.
        let stats = unsafe { stats.assume_init() };
        let available = stats.f_bavail.saturating_mul(stats.f_frsize);
        if available < required {
            return Err(ProviderError::DiskSpace);
        }
    }
    let _ = (path, required);
    Ok(())
}

fn build_gene_index_with_checksum(
    source: &Path,
    destination: &Path,
    matrix_sha256: &str,
) -> Result<(), ProviderError> {
    let mut reader = BufReader::new(std::fs::File::open(source)?);
    let mut line = String::new();
    let mut offset = reader.read_line(&mut line)? as u64;
    let header_length = offset;
    let mut features = BTreeMap::new();
    let mut offsets = BTreeMap::new();
    loop {
        line.clear();
        let count = reader.read_line(&mut line)?;
        if count == 0 {
            break;
        }
        if let Some(feature) = line.split('\t').next() {
            features.insert(
                feature.to_string(),
                serde_json::json!({"offset": offset, "length": count}),
            );
            offsets.insert(feature.to_string(), offset);
        }
        offset += count as u64;
    }
    let partial = PathBuf::from(format!("{}.part", destination.display()));
    serde_json::to_writer(
        std::fs::File::create(&partial)?,
        &serde_json::json!({
            "schema_version": 2,
            "matrix_sha256": matrix_sha256,
            "header": {"offset": 0, "length": header_length},
            "features": features
            ,"offsets": offsets
        }),
    )?;
    std::fs::rename(partial, destination)?;
    Ok(())
}

async fn upsert_resource_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    value: &ResourceUpsert,
) -> Result<Resource, sqlx::Error> {
    sqlx::query_as("INSERT INTO resources (id, kind, metadata, spec, status, provenance, permissions) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, metadata = EXCLUDED.metadata, spec = EXCLUDED.spec, status = EXCLUDED.status, provenance = EXCLUDED.provenance, permissions = EXCLUDED.permissions, updated_at = NOW() RETURNING id, kind, metadata, spec, status, provenance, permissions, created_at, updated_at")
        .bind(&value.id)
        .bind(&value.kind)
        .bind(&value.metadata)
        .bind(&value.spec)
        .bind(&value.status)
        .bind(&value.provenance)
        .bind(value.permissions.as_value())
        .fetch_one(&mut **transaction)
        .await
}

async fn upsert_artifact_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    value: &ArtifactUpsert,
) -> Result<Artifact, sqlx::Error> {
    sqlx::query_as("INSERT INTO artifacts (id, resource_id, uri, format, size, checksum, storage_backend, data_class, immutable, content_sha256, source_uri, derived_from, pipeline_version, retention_policy, storage_uri, schema_json, provenance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) ON CONFLICT (id) DO UPDATE SET resource_id = EXCLUDED.resource_id, uri = EXCLUDED.uri, format = EXCLUDED.format, size = EXCLUDED.size, checksum = EXCLUDED.checksum, storage_backend = EXCLUDED.storage_backend, data_class = EXCLUDED.data_class, immutable = EXCLUDED.immutable, content_sha256 = EXCLUDED.content_sha256, source_uri = EXCLUDED.source_uri, derived_from = EXCLUDED.derived_from, pipeline_version = EXCLUDED.pipeline_version, retention_policy = EXCLUDED.retention_policy, storage_uri = EXCLUDED.storage_uri, schema_json = EXCLUDED.schema_json, provenance = EXCLUDED.provenance WHERE NOT (artifacts.data_class = 'raw' AND artifacts.immutable AND artifacts.content_sha256 IS DISTINCT FROM EXCLUDED.content_sha256) RETURNING id, resource_id, uri, format, size, checksum, storage_backend, data_class, immutable, content_sha256, source_uri, derived_from, pipeline_version, retention_policy, storage_uri, schema_json, provenance, created_at")
        .bind(&value.id)
        .bind(&value.resource_id)
        .bind(&value.uri)
        .bind(&value.format)
        .bind(value.size)
        .bind(&value.checksum)
        .bind(&value.storage_backend)
        .bind(&value.data_class)
        .bind(value.immutable)
        .bind(&value.content_sha256)
        .bind(&value.source_uri)
        .bind(&value.derived_from)
        .bind(&value.pipeline_version)
        .bind(&value.retention_policy)
        .bind(&value.storage_uri)
        .bind(&value.schema_json)
        .bind(&value.provenance)
        .fetch_one(&mut **transaction)
        .await
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

    async fn start_ingestion(
        &self,
        provider_name: &str,
        provider_version: &str,
        resource_id: &str,
    ) -> Result<IngestionStart, ProviderError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
            .bind(format!("{provider_name}@{provider_version}"))
            .execute(&mut *transaction)
            .await?;
        let existing: Option<IngestionJob> = sqlx::query_as(
            "SELECT id, provider_name, provider_version, resource_id, status, error_code FROM ingestion_jobs WHERE provider_name = $1 AND provider_version = $2 FOR UPDATE",
        )
        .bind(provider_name)
        .bind(provider_version)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(job) = &existing {
            if job.status == "available" {
                let resource = sqlx::query_as(
                    "SELECT id, kind, metadata, spec, status, provenance, permissions, created_at, updated_at FROM resources WHERE id = $1",
                )
                .bind(&job.resource_id)
                .fetch_optional(&mut *transaction)
                .await?
                .ok_or(ProviderError::InvalidState)?;
                transaction.commit().await?;
                return Ok(IngestionStart::Available(resource));
            }
            if matches!(
                job.status.as_str(),
                "registered" | "downloading" | "verifying" | "materializing"
            ) {
                return Err(ProviderError::Busy);
            }
        }
        let id = existing
            .as_ref()
            .map(|job| job.id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let job: IngestionJob = sqlx::query_as(
            "INSERT INTO ingestion_jobs (id, provider_name, provider_version, resource_id, status, error_code) VALUES ($1, $2, $3, $4, 'registered', NULL) ON CONFLICT (provider_name, provider_version) DO UPDATE SET resource_id = EXCLUDED.resource_id, status = 'registered', error_code = NULL, updated_at = NOW() RETURNING id, provider_name, provider_version, resource_id, status, error_code",
        )
        .bind(&id)
        .bind(provider_name)
        .bind(provider_version)
        .bind(resource_id)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(IngestionStart::Started(job))
    }

    async fn transition_ingestion(&self, id: &str, status: &str) -> Result<(), ProviderError> {
        let result = sqlx::query(
            "UPDATE ingestion_jobs SET status = $2, error_code = NULL, updated_at = NOW() WHERE id = $1 AND status IN ('registered', 'downloading', 'verifying', 'materializing')",
        )
        .bind(id)
        .bind(status)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(ProviderError::InvalidState);
        }
        Ok(())
    }

    async fn fail_ingestion(&self, id: &str, error_code: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE ingestion_jobs SET status = 'failed', error_code = $2, updated_at = NOW() WHERE id = $1 AND status <> 'available'",
        )
        .bind(id)
        .bind(error_code)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn publish_ingestion(
        &self,
        job_id: &str,
        resource: &ResourceUpsert,
        artifacts: &[ArtifactUpsert],
    ) -> Result<Resource, sqlx::Error> {
        if artifacts.is_empty() {
            return Err(sqlx::Error::Protocol("provider has no artifacts".into()));
        }
        let mut transaction = self.pool.begin().await?;
        let job_status: Option<String> =
            sqlx::query_scalar("SELECT status FROM ingestion_jobs WHERE id = $1 FOR UPDATE")
                .bind(job_id)
                .fetch_optional(&mut *transaction)
                .await?;
        if job_status.as_deref() != Some("materializing") {
            return Err(sqlx::Error::Protocol(
                "ingestion job is not materializing".into(),
            ));
        }
        let data = upsert_resource_transaction(&mut transaction, resource).await?;
        for artifact in artifacts {
            if artifact.resource_id != data.id {
                return Err(sqlx::Error::Protocol("artifact resource mismatch".into()));
            }
            upsert_artifact_transaction(&mut transaction, artifact).await?;
        }
        sqlx::query(
            "UPDATE ingestion_jobs SET status = 'available', error_code = NULL, updated_at = NOW() WHERE id = $1",
        )
        .bind(job_id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(data)
    }

    pub async fn import_atomic(
        &self,
        resources: &[ResourceUpsert],
        artifacts: &[ArtifactUpsert],
        relations: &[RelationUpsert],
        grants: &[(String, String)],
    ) -> Result<(), ProviderError> {
        for resource in resources {
            if resource.status == "available"
                && !artifacts
                    .iter()
                    .any(|artifact| artifact.resource_id == resource.id)
            {
                return Err(ProviderError::MissingArtifact);
            }
        }
        for artifact in artifacts {
            let is_available = resources
                .iter()
                .find(|resource| resource.id == artifact.resource_id)
                .is_some_and(|resource| resource.status == "available");
            if is_available && artifact.storage_backend == "local" {
                let metadata =
                    std::fs::metadata(&artifact.uri).map_err(|_| ProviderError::MissingArtifact)?;
                if !metadata.is_file() {
                    return Err(ProviderError::MissingArtifact);
                }
                if artifact
                    .size
                    .is_some_and(|size| metadata.len() != size as u64)
                {
                    return Err(ProviderError::Size);
                }
            }
        }
        let mut transaction = self.pool.begin().await?;
        for resource in resources {
            upsert_resource_transaction(&mut transaction, resource).await?;
        }
        for artifact in artifacts {
            upsert_artifact_transaction(&mut transaction, artifact).await?;
        }
        for relation in relations {
            sqlx::query("INSERT INTO relations (source, target, relation_type, evidence, provenance) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (source, target, relation_type) DO UPDATE SET evidence = EXCLUDED.evidence, provenance = EXCLUDED.provenance")
                .bind(&relation.source)
                .bind(&relation.target)
                .bind(&relation.relation_type)
                .bind(&relation.evidence)
                .bind(&relation.provenance)
                .execute(&mut *transaction)
                .await?;
        }
        for (resource_id, user_id) in grants {
            sqlx::query("INSERT INTO resource_grants (resource_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
                .bind(resource_id)
                .bind(user_id)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn reconcile_local_availability(
        &self,
        data_root: &Path,
    ) -> Result<Vec<String>, sqlx::Error> {
        let root = match data_root.canonicalize() {
            Ok(root) => root,
            Err(_) => return Ok(vec![]),
        };
        let artifacts: Vec<(String, String, Option<i64>)> = sqlx::query_as(
            "SELECT r.id, a.uri, a.size FROM resources r JOIN artifacts a ON a.resource_id = r.id WHERE r.status = 'available' AND a.storage_backend = 'local'",
        )
        .fetch_all(&self.pool)
        .await?;
        let unavailable: BTreeMap<String, ()> = artifacts
            .into_iter()
            .filter_map(|(resource_id, uri, size)| {
                let available = PathBuf::from(uri)
                    .canonicalize()
                    .ok()
                    .and_then(|path| path.metadata().ok().map(|metadata| (path, metadata)))
                    .is_some_and(|(path, metadata)| {
                        path.starts_with(&root)
                            && metadata.is_file()
                            && size.is_none_or(|size| metadata.len() == size as u64)
                    });
                (!available).then_some((resource_id, ()))
            })
            .collect();
        if unavailable.is_empty() {
            return Ok(vec![]);
        }
        let ids = unavailable.into_keys().collect::<Vec<_>>();
        sqlx::query(
            "UPDATE resources SET status = 'unavailable', updated_at = NOW() WHERE id = ANY($1)",
        )
        .bind(&ids)
        .execute(&self.pool)
        .await?;
        Ok(ids)
    }

    pub async fn list_resources(
        &self,
        search: Option<&str>,
        include_private: bool,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Resource>, sqlx::Error> {
        if !(1..=500).contains(&limit) {
            return Err(sqlx::Error::Protocol(
                "resource list limit must be between 1 and 500".into(),
            ));
        }
        if !(0..=1_000_000).contains(&offset) {
            return Err(sqlx::Error::Protocol(
                "resource list offset must be between 0 and 1000000".into(),
            ));
        }
        sqlx::query_as("SELECT id, kind, metadata, spec, status, provenance, permissions, created_at, updated_at FROM resources WHERE ($1::text IS NULL OR to_tsvector('simple', id || ' ' || kind || ' ' || metadata::text) @@ websearch_to_tsquery('simple', $1)) AND ($2 OR permissions->>'visibility' = 'public') ORDER BY id LIMIT $3 OFFSET $4")
            .bind(search).bind(include_private).bind(limit).bind(offset).fetch_all(&self.pool).await
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
        sqlx::query_as("SELECT id, resource_id, uri, format, size, checksum, storage_backend, data_class, immutable, content_sha256, source_uri, derived_from, pipeline_version, retention_policy, storage_uri, schema_json, provenance, created_at FROM artifacts WHERE resource_id = $1 ORDER BY id")
            .bind(resource_id).fetch_all(&self.pool).await
    }

    pub async fn get_artifact(&self, id: &str) -> Result<Option<Artifact>, sqlx::Error> {
        sqlx::query_as("SELECT id, resource_id, uri, format, size, checksum, storage_backend, data_class, immutable, content_sha256, source_uri, derived_from, pipeline_version, retention_policy, storage_uri, schema_json, provenance, created_at FROM artifacts WHERE id = $1")
            .bind(id).fetch_optional(&self.pool).await
    }

    pub async fn upsert_artifact(&self, value: &ArtifactUpsert) -> Result<Artifact, sqlx::Error> {
        sqlx::query_as("INSERT INTO artifacts (id, resource_id, uri, format, size, checksum, storage_backend, data_class, immutable, content_sha256, source_uri, derived_from, pipeline_version, retention_policy, storage_uri, schema_json, provenance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) ON CONFLICT (id) DO UPDATE SET resource_id = EXCLUDED.resource_id, uri = EXCLUDED.uri, format = EXCLUDED.format, size = EXCLUDED.size, checksum = EXCLUDED.checksum, storage_backend = EXCLUDED.storage_backend, data_class = EXCLUDED.data_class, immutable = EXCLUDED.immutable, content_sha256 = EXCLUDED.content_sha256, source_uri = EXCLUDED.source_uri, derived_from = EXCLUDED.derived_from, pipeline_version = EXCLUDED.pipeline_version, retention_policy = EXCLUDED.retention_policy, storage_uri = EXCLUDED.storage_uri, schema_json = EXCLUDED.schema_json, provenance = EXCLUDED.provenance WHERE NOT (artifacts.data_class = 'raw' AND artifacts.immutable AND artifacts.content_sha256 IS DISTINCT FROM EXCLUDED.content_sha256) RETURNING id, resource_id, uri, format, size, checksum, storage_backend, data_class, immutable, content_sha256, source_uri, derived_from, pipeline_version, retention_policy, storage_uri, schema_json, provenance, created_at")
            .bind(&value.id).bind(&value.resource_id).bind(&value.uri).bind(&value.format).bind(value.size).bind(&value.checksum).bind(&value.storage_backend).bind(&value.data_class).bind(value.immutable).bind(&value.content_sha256).bind(&value.source_uri).bind(&value.derived_from).bind(&value.pipeline_version).bind(&value.retention_policy).bind(&value.storage_uri).bind(&value.schema_json).bind(&value.provenance)
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

    pub async fn has_users(&self) -> Result<bool, sqlx::Error> {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)")
            .fetch_one(&self.pool)
            .await
    }

    pub async fn get_user(&self, id: &str) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as("SELECT id, display_name, email, role, status, created_at, updated_at FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn get_user_credentials(
        &self,
        email: &str,
    ) -> Result<Option<UserCredentials>, sqlx::Error> {
        sqlx::query_as("SELECT id, display_name, email, role, status, password_hash, totp_secret, created_at, updated_at FROM users WHERE LOWER(email) = LOWER($1)")
            .bind(email)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn get_user_security(
        &self,
        id: &str,
    ) -> Result<Option<UserCredentials>, sqlx::Error> {
        sqlx::query_as("SELECT id, display_name, email, role, status, password_hash, totp_secret, created_at, updated_at FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn store_access_token(
        &self,
        token_hash: &str,
        user_id: &str,
        expires_at: u64,
        scopes: &serde_json::Value,
    ) -> Result<(), sqlx::Error> {
        let expires_at = chrono::DateTime::<chrono::Utc>::from_timestamp(expires_at as i64, 0)
            .unwrap_or_else(chrono::Utc::now);
        sqlx::query("INSERT INTO access_tokens (token_hash, user_id, issued_at, expires_at, scopes) VALUES ($1, $2, NOW(), $3, $4)")
            .bind(token_hash)
            .bind(user_id)
            .bind(expires_at)
            .bind(scopes)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn token_is_active(&self, token_hash: &str) -> Result<bool, sqlx::Error> {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM access_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW())")
            .bind(token_hash)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn revoke_access_token(&self, token_hash: &str) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("UPDATE access_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL")
            .bind(token_hash)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn list_access_tokens(&self, user_id: &str) -> Result<Vec<AccessToken>, sqlx::Error> {
        sqlx::query_as("SELECT token_hash, user_id, issued_at, expires_at, revoked_at, scopes FROM access_tokens t WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() AND NOT EXISTS (SELECT 1 FROM auth_sessions s WHERE s.token_hash=t.token_hash) ORDER BY issued_at DESC")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn upsert_user(&self, value: &UserUpsert) -> Result<User, sqlx::Error> {
        sqlx::query_as("INSERT INTO users (id, display_name, email, role, status, password_hash, totp_secret) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, role = EXCLUDED.role, status = EXCLUDED.status, password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash), totp_secret = COALESCE(EXCLUDED.totp_secret, users.totp_secret), updated_at = NOW() RETURNING id, display_name, email, role, status, created_at, updated_at")
            .bind(&value.id)
            .bind(&value.display_name)
            .bind(&value.email)
            .bind(&value.role)
            .bind(&value.status)
            .bind(&value.password_hash)
            .bind(&value.totp_secret)
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
    use super::{
        ProviderError, ProviderInstaller, build_gene_index_with_checksum, decompress_gzip,
        ensure_disk_space, validate_checksum, verify_checksum,
    };
    use sha2::{Digest, Sha256};
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
        build_gene_index_with_checksum(&matrix, &index, "abc").unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&index).unwrap()).unwrap();
        assert_eq!(value["schema_version"], 2);
        assert_eq!(value["matrix_sha256"], "abc");
        assert_eq!(value["features"]["ENSG1.1"]["offset"], 10);
        assert_eq!(value["features"]["ENSG1.1"]["length"], 10);
        assert_eq!(value["features"]["ENSG2.4"]["offset"], 20);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn validates_sha256_metadata() {
        assert!(
            validate_checksum(
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            )
            .is_ok()
        );
        assert!(validate_checksum("not-a-checksum").is_err());
        assert!(
            verify_checksum(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            )
            .is_ok()
        );
        assert!(matches!(
            verify_checksum(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            ),
            Err(ProviderError::Checksum)
        ));
    }

    #[tokio::test]
    async fn gzip_materialization_is_hashed_and_bounded() {
        let directory = temp_dir().join(format!("shennong-gzip-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).await.unwrap();
        let input = directory.join("input.tsv");
        let source = directory.join("input.tsv.gz");
        let destination = directory.join("output.tsv");
        let content = b"gene\tvalue\nYTHDF2\t1\n";
        fs::write(&input, content).await.unwrap();
        let status = std::process::Command::new("gzip")
            .args(["-c"])
            .arg(&input)
            .stdout(std::fs::File::create(&source).unwrap())
            .status()
            .unwrap();
        assert!(status.success());
        let checksum = decompress_gzip(
            source,
            destination.clone(),
            content.len() as u64,
            content.len() as u64 + 1,
            std::time::Duration::from_secs(5),
        )
        .await
        .unwrap();
        let mut digest = Sha256::new();
        digest.update(content);
        assert_eq!(checksum, format!("{:x}", digest.finalize()));
        assert_eq!(fs::read(&destination).await.unwrap(), content);
        assert!(directory.join("input.tsv.gz").is_file());

        let limited = directory.join("limited.tsv");
        let error = decompress_gzip(
            directory.join("input.tsv.gz"),
            limited.clone(),
            2,
            2,
            std::time::Duration::from_secs(5),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, ProviderError::TooLarge));
        assert!(!limited.exists());
        let insufficient = directory.join("insufficient.tsv");
        let error = decompress_gzip(
            directory.join("input.tsv.gz"),
            insufficient,
            content.len() as u64 + 1,
            content.len() as u64 + 1,
            std::time::Duration::from_secs(5),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, ProviderError::Size));
        assert!(matches!(
            ensure_disk_space(&directory, u64::MAX),
            Err(ProviderError::DiskSpace)
        ));
        fs::remove_dir_all(directory).await.unwrap();
    }
}
