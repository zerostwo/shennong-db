use async_trait::async_trait;
use std::{
    fmt,
    io::Cursor,
    path::{Component, Path, PathBuf},
    pin::Pin,
    str::FromStr,
    time::SystemTime,
};
use thiserror::Error;
use tokio::{
    fs::{self, File, OpenOptions},
    io::{self, AsyncRead, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom},
};
use uuid::Uuid;

pub type BlobReader = Pin<Box<dyn AsyncRead + Send + Unpin>>;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("storage URI is invalid")]
    InvalidUri,
    #[error("storage object key is invalid")]
    InvalidKey,
    #[error("storage URI is outside the configured root")]
    OutsideRoot,
    #[error("storage backend is not supported by this adapter")]
    UnsupportedBackend,
    #[error("storage presigning is not supported by this backend")]
    PresignUnsupported,
    #[error("storage object length does not match the declared length")]
    LengthMismatch,
    #[error(transparent)]
    Io(#[from] io::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArtifactUri {
    Local(PathBuf),
    S3 { bucket: String, key: ObjectKey },
}

impl FromStr for ArtifactUri {
    type Err = StorageError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if let Some(path) = value.strip_prefix("file://") {
            let path = path.strip_prefix('/').map_or(path, |value| {
                if value.starts_with('/') { value } else { path }
            });
            return Ok(Self::Local(PathBuf::from(if path.starts_with('/') {
                path.to_owned()
            } else {
                format!("/{path}")
            })));
        }
        if let Some(value) = value.strip_prefix("s3://") {
            let (bucket, key) = value.split_once('/').ok_or(StorageError::InvalidUri)?;
            if bucket.is_empty() {
                return Err(StorageError::InvalidUri);
            }
            return Ok(Self::S3 {
                bucket: bucket.to_owned(),
                key: ObjectKey::new(key)?,
            });
        }
        if value.contains("://") {
            return Err(StorageError::InvalidUri);
        }
        Ok(Self::Local(PathBuf::from(value)))
    }
}

impl ArtifactUri {
    pub fn parse(value: &str) -> Result<Self, StorageError> {
        value.parse()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectKey(String);

impl ObjectKey {
    pub fn new(value: &str) -> Result<Self, StorageError> {
        let path = Path::new(value);
        if value.is_empty()
            || path.is_absolute()
            || path.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(StorageError::InvalidKey);
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteRange {
    pub start: u64,
    pub end: u64,
}

impl ByteRange {
    pub fn new(start: u64, end: u64) -> Result<Self, StorageError> {
        if end < start {
            return Err(StorageError::InvalidKey);
        }
        Ok(Self { start, end })
    }

    pub fn len(self) -> u64 {
        self.end - self.start + 1
    }

    pub fn is_empty(self) -> bool {
        self.start > self.end
    }
}

#[derive(Debug, Clone, Default)]
pub struct ObjectMeta {
    pub size: u64,
    pub etag: Option<String>,
    pub sha256: Option<String>,
    pub content_type: Option<String>,
    pub last_modified: Option<SystemTime>,
    pub version_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageCapability {
    Head,
    Stream,
    Range,
    Put,
    Delete,
    Copy,
    Presign,
}

#[async_trait]
pub trait BlobStore: Send + Sync {
    async fn head(&self, uri: &ArtifactUri) -> Result<ObjectMeta, StorageError>;
    async fn get_stream(&self, uri: &ArtifactUri) -> Result<BlobReader, StorageError>;
    async fn get_range(
        &self,
        uri: &ArtifactUri,
        range: ByteRange,
    ) -> Result<BlobReader, StorageError>;
    async fn put_stream(
        &self,
        key: &ObjectKey,
        reader: &mut (dyn AsyncRead + Send + Unpin),
    ) -> Result<ArtifactUri, StorageError>;
    async fn delete(&self, uri: &ArtifactUri) -> Result<(), StorageError>;
    async fn exists(&self, uri: &ArtifactUri) -> Result<bool, StorageError>;
    async fn copy_or_promote(
        &self,
        source: &ArtifactUri,
        destination: &ObjectKey,
    ) -> Result<ArtifactUri, StorageError>;
    async fn presign_get(&self, _uri: &ArtifactUri) -> Result<String, StorageError> {
        Err(StorageError::PresignUnsupported)
    }
}

#[async_trait]
pub trait ObjectStorage: BlobStore {
    async fn read(&self, uri: &str) -> Result<Vec<u8>, StorageError> {
        let uri = ArtifactUri::parse(uri)?;
        let mut reader = self.get_stream(&uri).await?;
        let mut data = Vec::new();
        reader.read_to_end(&mut data).await?;
        Ok(data)
    }

    async fn write(&self, key: &str, data: &[u8]) -> Result<String, StorageError> {
        let key = ObjectKey::new(key)?;
        let mut reader = Cursor::new(data);
        Ok(self.put_stream(&key, &mut reader).await?.to_string())
    }
}

impl<T: BlobStore + ?Sized> ObjectStorage for T {}

#[derive(Debug, Clone)]
pub struct LocalObjectStorage {
    root: PathBuf,
}

impl LocalObjectStorage {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn resolve(&self, value: &str) -> Result<PathBuf, StorageError> {
        let uri = ArtifactUri::parse(value)?;
        self.resolve_uri(&uri)
    }

    fn root(&self) -> Result<PathBuf, StorageError> {
        self.root.canonicalize().map_err(StorageError::Io)
    }

    fn resolve_uri(&self, uri: &ArtifactUri) -> Result<PathBuf, StorageError> {
        let ArtifactUri::Local(value) = uri else {
            return Err(StorageError::UnsupportedBackend);
        };
        let candidate = if value.is_absolute() {
            value.clone()
        } else {
            self.root.join(value)
        };
        let resolved = candidate.canonicalize().map_err(StorageError::Io)?;
        if resolved.starts_with(self.root()?) {
            Ok(resolved)
        } else {
            Err(StorageError::OutsideRoot)
        }
    }

    fn resolve_key(&self, key: &ObjectKey) -> Result<PathBuf, StorageError> {
        let root = self.root()?;
        let candidate = root.join(key.as_str());
        let mut existing = candidate.parent().ok_or(StorageError::InvalidKey)?;
        while !existing.exists() {
            existing = existing.parent().ok_or(StorageError::InvalidKey)?;
        }
        let resolved_existing = existing.canonicalize().map_err(StorageError::Io)?;
        if !resolved_existing.starts_with(&root) {
            return Err(StorageError::OutsideRoot);
        }
        let remainder = candidate
            .strip_prefix(existing)
            .map_err(|_| StorageError::InvalidKey)?;
        let resolved = resolved_existing.join(remainder);
        if resolved.exists() {
            let canonical = resolved.canonicalize().map_err(StorageError::Io)?;
            if !canonical.starts_with(&root) {
                return Err(StorageError::OutsideRoot);
            }
        }
        Ok(resolved)
    }
}

#[async_trait]
impl BlobStore for LocalObjectStorage {
    async fn head(&self, uri: &ArtifactUri) -> Result<ObjectMeta, StorageError> {
        let metadata = fs::metadata(self.resolve_uri(uri)?).await?;
        Ok(ObjectMeta {
            size: metadata.len(),
            last_modified: metadata.modified().ok(),
            ..ObjectMeta::default()
        })
    }

    async fn get_stream(&self, uri: &ArtifactUri) -> Result<BlobReader, StorageError> {
        Ok(Box::pin(File::open(self.resolve_uri(uri)?).await?))
    }

    async fn get_range(
        &self,
        uri: &ArtifactUri,
        range: ByteRange,
    ) -> Result<BlobReader, StorageError> {
        let mut file = File::open(self.resolve_uri(uri)?).await?;
        let size = file.metadata().await?.len();
        if range.end >= size {
            return Err(StorageError::LengthMismatch);
        }
        file.seek(SeekFrom::Start(range.start)).await?;
        Ok(Box::pin(file.take(range.len())))
    }

    async fn put_stream(
        &self,
        key: &ObjectKey,
        reader: &mut (dyn AsyncRead + Send + Unpin),
    ) -> Result<ArtifactUri, StorageError> {
        let destination = self.resolve_key(key)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).await?;
        }
        let partial = destination.with_extension(format!("part-{}", Uuid::new_v4()));
        let result = async {
            let mut output = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&partial)
                .await?;
            io::copy(reader, &mut output).await?;
            output.flush().await?;
            output.sync_all().await?;
            fs::rename(&partial, &destination).await?;
            Ok::<(), io::Error>(())
        }
        .await;
        if result.is_err() {
            let _ = fs::remove_file(&partial).await;
        }
        result?;
        Ok(ArtifactUri::Local(destination))
    }

    async fn delete(&self, uri: &ArtifactUri) -> Result<(), StorageError> {
        fs::remove_file(self.resolve_uri(uri)?).await?;
        Ok(())
    }

    async fn exists(&self, uri: &ArtifactUri) -> Result<bool, StorageError> {
        match uri {
            ArtifactUri::Local(_) => Ok(fs::metadata(self.resolve_uri(uri)?).await.is_ok()),
            ArtifactUri::S3 { .. } => Err(StorageError::UnsupportedBackend),
        }
    }

    async fn copy_or_promote(
        &self,
        source: &ArtifactUri,
        destination: &ObjectKey,
    ) -> Result<ArtifactUri, StorageError> {
        let mut reader = self.get_stream(source).await?;
        self.put_stream(destination, &mut reader).await
    }
}

impl fmt::Display for ArtifactUri {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Local(path) => path.display().fmt(formatter),
            Self::S3 { bucket, key } => write!(formatter, "s3://{bucket}/{}", key.as_str()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ArtifactUri, BlobStore, ByteRange, LocalObjectStorage, ObjectKey, StorageError};
    use std::env::temp_dir;
    use std::{
        pin::Pin,
        task::{Context, Poll},
    };
    use tokio::{
        fs,
        io::{AsyncRead, AsyncReadExt},
    };
    use uuid::Uuid;

    struct FailingReader;

    impl AsyncRead for FailingReader {
        fn poll_read(
            self: Pin<&mut Self>,
            _context: &mut Context<'_>,
            _buffer: &mut tokio::io::ReadBuf<'_>,
        ) -> Poll<std::io::Result<()>> {
            Poll::Ready(Err(std::io::Error::other("interrupted fixture")))
        }
    }

    #[tokio::test]
    async fn local_blob_store_streams_ranges_and_publishes_atomically() {
        let root = temp_dir().join(format!("shennong-storage-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).await.unwrap();
        let storage = LocalObjectStorage::new(&root);
        let key = ObjectKey::new("nested/value.tsv").unwrap();
        let mut input = std::io::Cursor::new(b"abcdef".to_vec());
        let uri = storage.put_stream(&key, &mut input).await.unwrap();
        let meta = storage.head(&uri).await.unwrap();
        assert_eq!(meta.size, 6);
        let mut full = storage.get_stream(&uri).await.unwrap();
        let mut value = Vec::new();
        full.read_to_end(&mut value).await.unwrap();
        assert_eq!(value, b"abcdef");
        let mut range = storage
            .get_range(&uri, ByteRange::new(1, 3).unwrap())
            .await
            .unwrap();
        let mut value = Vec::new();
        range.read_to_end(&mut value).await.unwrap();
        assert_eq!(value, b"bcd");
        assert!(storage.exists(&uri).await.unwrap());
        assert!(matches!(
            storage.presign_get(&uri).await,
            Err(StorageError::PresignUnsupported)
        ));
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn interrupted_put_does_not_publish_a_partial_object() {
        let root = temp_dir().join(format!("shennong-storage-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).await.unwrap();
        let storage = LocalObjectStorage::new(&root);
        let key = ObjectKey::new("interrupted/value.bin").unwrap();
        let mut reader = FailingReader;
        assert!(storage.put_stream(&key, &mut reader).await.is_err());
        let mut entries = fs::read_dir(root.join("interrupted")).await.unwrap();
        assert!(entries.next_entry().await.unwrap().is_none());
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn local_blob_store_rejects_traversal_and_symlink_escape() {
        let root = temp_dir().join(format!("shennong-storage-{}", Uuid::new_v4()));
        let outside = temp_dir().join(format!("shennong-outside-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).await.unwrap();
        fs::create_dir_all(&outside).await.unwrap();
        fs::write(outside.join("secret"), b"secret").await.unwrap();
        let storage = LocalObjectStorage::new(&root);
        assert!(matches!(
            ObjectKey::new("../secret"),
            Err(StorageError::InvalidKey)
        ));
        assert!(matches!(
            storage.resolve(outside.join("secret").to_str().unwrap()),
            Err(StorageError::OutsideRoot)
        ));
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
        #[cfg(unix)]
        assert!(matches!(
            storage.resolve("escape/secret"),
            Err(StorageError::OutsideRoot)
        ));
        fs::remove_dir_all(root).await.unwrap();
        fs::remove_dir_all(outside).await.unwrap();
    }

    #[test]
    fn parses_local_and_s3_uris() {
        assert!(matches!(
            ArtifactUri::parse("file:///data/value.tsv").unwrap(),
            ArtifactUri::Local(_)
        ));
        assert!(matches!(
            ArtifactUri::parse("s3://bucket/path/value.tsv").unwrap(),
            ArtifactUri::S3 { .. }
        ));
        assert!(ArtifactUri::parse("https://example.org/value").is_err());
    }
}
