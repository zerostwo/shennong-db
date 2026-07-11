use async_trait::async_trait;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("storage URI is outside the configured root")]
    OutsideRoot,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

#[async_trait]
pub trait ObjectStorage: Send + Sync {
    async fn read(&self, uri: &str) -> Result<Vec<u8>, StorageError>;
    async fn write(&self, key: &str, data: &[u8]) -> Result<String, StorageError>;
}

#[derive(Debug, Clone)]
pub struct LocalObjectStorage {
    root: PathBuf,
}

impl LocalObjectStorage {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn resolve(&self, value: &str) -> Result<PathBuf, StorageError> {
        let path = Path::new(value);
        let candidate = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.root.join(path)
        };
        let root = self
            .root
            .canonicalize()
            .unwrap_or_else(|_| self.root.clone());
        let resolved = candidate.canonicalize()?;
        if resolved.starts_with(root) {
            Ok(resolved)
        } else {
            Err(StorageError::OutsideRoot)
        }
    }
}

#[async_trait]
impl ObjectStorage for LocalObjectStorage {
    async fn read(&self, uri: &str) -> Result<Vec<u8>, StorageError> {
        Ok(tokio::fs::read(self.resolve(uri)?).await?)
    }

    async fn write(&self, key: &str, data: &[u8]) -> Result<String, StorageError> {
        if Path::new(key).is_absolute()
            || Path::new(key)
                .components()
                .any(|part| part.as_os_str() == "..")
        {
            return Err(StorageError::OutsideRoot);
        }
        let path = self.root.join(key);
        if !path.starts_with(&self.root) {
            return Err(StorageError::OutsideRoot);
        }
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&path, data).await?;
        Ok(path.display().to_string())
    }
}
