use crate::{ArtifactUri, BlobReader, BlobStore, ByteRange, ObjectKey, ObjectMeta, StorageError};
use async_trait::async_trait;
use futures_util::TryStreamExt;
use hmac::{Hmac, Mac};
use reqwest::{Client, Method, Request, header::HeaderMap};
use sha2::{Digest, Sha256};
use std::{env, fs, io, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    time::sleep,
};
use tokio_util::io::StreamReader;
use url::Url;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone)]
pub struct S3Config {
    pub endpoint: Url,
    pub region: String,
    pub force_path_style: bool,
    pub bucket: String,
    pub access_key: Option<String>,
    pub secret_key: Option<String>,
    pub session_token: Option<String>,
    pub connect_timeout: Duration,
    pub request_timeout: Duration,
    pub max_retries: usize,
    pub multipart_part_size: usize,
    pub presign_ttl: Duration,
}

impl S3Config {
    pub fn from_env(bucket: impl Into<String>) -> Result<Self, StorageError> {
        let endpoint = env::var("SHENNONG_S3_ENDPOINT")
            .ok()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "https://s3.amazonaws.com".into())
            .parse()
            .map_err(|_| StorageError::InvalidUri)?;
        let credentials = env::var("AWS_SHARED_CREDENTIALS_FILE")
            .ok()
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|file| parse_credentials(&file));
        Ok(Self {
            endpoint,
            region: env::var("SHENNONG_S3_REGION").unwrap_or_else(|_| "us-east-1".into()),
            force_path_style: env_bool("SHENNONG_S3_FORCE_PATH_STYLE"),
            bucket: bucket.into(),
            access_key: env::var("AWS_ACCESS_KEY_ID")
                .ok()
                .or_else(|| credentials.as_ref().map(|v| v.0.clone())),
            secret_key: env::var("AWS_SECRET_ACCESS_KEY")
                .ok()
                .or_else(|| credentials.as_ref().map(|v| v.1.clone())),
            session_token: env::var("AWS_SESSION_TOKEN").ok(),
            connect_timeout: env_duration("SHENNONG_S3_CONNECT_TIMEOUT_SECS", 5),
            request_timeout: env_duration("SHENNONG_S3_REQUEST_TIMEOUT_SECS", 60),
            max_retries: env::var("SHENNONG_S3_MAX_RETRIES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(3),
            multipart_part_size: env::var("SHENNONG_S3_MULTIPART_PART_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8 * 1024 * 1024),
            presign_ttl: env_duration("SHENNONG_S3_PRESIGN_TTL_SECS", 300),
        })
    }

    fn credentials(&self) -> Result<(&str, &str), StorageError> {
        match (self.access_key.as_deref(), self.secret_key.as_deref()) {
            (Some(access), Some(secret)) => Ok((access, secret)),
            _ => Err(StorageError::Credentials),
        }
    }
}

#[derive(Clone)]
pub struct S3ObjectStorage {
    config: S3Config,
    client: Client,
}

impl S3ObjectStorage {
    pub fn new(config: S3Config) -> Result<Self, StorageError> {
        let client = Client::builder()
            .connect_timeout(config.connect_timeout)
            .timeout(config.request_timeout)
            .build()
            .map_err(|_| StorageError::Http)?;
        Ok(Self { config, client })
    }

    pub fn config(&self) -> &S3Config {
        &self.config
    }

    fn url(&self, key: &ObjectKey) -> Result<Url, StorageError> {
        let mut url = self.config.endpoint.clone();
        if self.config.force_path_style || url.host_str().is_none() {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| StorageError::InvalidUri)?;
            segments.push(&self.config.bucket);
            for part in key.as_str().split('/') {
                segments.push(part);
            }
        } else {
            let host = url.host_str().ok_or(StorageError::InvalidUri)?.to_owned();
            url.set_host(Some(&format!("{}.{}", self.config.bucket, host)))
                .map_err(|_| StorageError::InvalidUri)?;
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| StorageError::InvalidUri)?;
            for part in key.as_str().split('/') {
                segments.push(part);
            }
        }
        Ok(url)
    }

    fn uri_key(&self, uri: &ArtifactUri) -> Result<ObjectKey, StorageError> {
        match uri {
            ArtifactUri::S3 { bucket, key } if bucket == &self.config.bucket => Ok(key.clone()),
            ArtifactUri::S3 { .. } => Err(StorageError::UnsupportedBackend),
            ArtifactUri::Local(_) => Err(StorageError::UnsupportedBackend),
        }
    }

    async fn request(
        &self,
        method: Method,
        url: Url,
        mut headers: HeaderMap,
        body: Option<reqwest::Body>,
    ) -> Result<reqwest::Response, StorageError> {
        let mut request = Request::new(method, url);
        *request.headers_mut() = std::mem::take(&mut headers);
        *request.body_mut() = body;
        if self.config.access_key.is_some() || self.config.secret_key.is_some() {
            sign_request(&mut request, &self.config)?;
        }
        let mut last_error = None;
        for attempt in 0..=self.config.max_retries {
            match self
                .client
                .execute(request.try_clone().ok_or(StorageError::Http)?)
                .await
            {
                Ok(response)
                    if !is_retryable(response.status()) || attempt == self.config.max_retries =>
                {
                    return Ok(response);
                }
                Ok(response) => {
                    last_error = Some(response.status());
                    sleep(Duration::from_millis(50 * (attempt as u64 + 1))).await;
                }
                Err(_) if attempt == self.config.max_retries => return Err(StorageError::Http),
                Err(_) => sleep(Duration::from_millis(50 * (attempt as u64 + 1))).await,
            }
        }
        let _ = last_error;
        Err(StorageError::Http)
    }

    async fn checked(
        &self,
        method: Method,
        url: Url,
        headers: HeaderMap,
        body: Option<reqwest::Body>,
    ) -> Result<reqwest::Response, StorageError> {
        let response = self.request(method, url, headers, body).await?;
        if response.status().is_success() {
            Ok(response)
        } else {
            Err(StorageError::Http)
        }
    }

    async fn multipart_put(
        &self,
        key: &ObjectKey,
        reader: &mut (dyn AsyncRead + Send + Unpin),
    ) -> Result<(), StorageError> {
        let base = self.url(key)?;
        let response = self
            .checked(
                Method::POST,
                with_query(&base, "uploads", ""),
                HeaderMap::new(),
                None,
            )
            .await?;
        let upload_id = xml_tag(
            &response.bytes().await.map_err(|_| StorageError::Http)?,
            "UploadId",
        )
        .ok_or(StorageError::Protocol)?;
        let mut part_number = 1_u32;
        let mut etags = Vec::new();
        loop {
            let mut chunk = vec![0_u8; self.config.multipart_part_size.max(5 * 1024 * 1024)];
            let count = reader
                .read(&mut chunk)
                .await
                .map_err(|_| StorageError::Io(io::Error::other("s3 read")))?;
            if count == 0 {
                break;
            }
            chunk.truncate(count);
            let part_url = with_query_pair(
                &base,
                "partNumber",
                &part_number.to_string(),
                "uploadId",
                &upload_id,
            );
            let mut response = None;
            for attempt in 0..=self.config.max_retries {
                match self
                    .checked(
                        Method::PUT,
                        part_url.clone(),
                        HeaderMap::new(),
                        Some(reqwest::Body::from(chunk.clone())),
                    )
                    .await
                {
                    Ok(value) => {
                        response = Some(value);
                        break;
                    }
                    Err(_) if attempt < self.config.max_retries => {
                        sleep(Duration::from_millis(50 * (attempt as u64 + 1))).await
                    }
                    Err(error) => return Err(error),
                }
            }
            let response = response.ok_or(StorageError::Http)?;
            let etag = response
                .headers()
                .get("etag")
                .and_then(|v| v.to_str().ok())
                .ok_or(StorageError::Protocol)?
                .to_owned();
            etags.push((part_number, etag));
            part_number += 1;
        }
        if etags.is_empty() {
            let _ = self
                .checked(
                    Method::DELETE,
                    with_query(&base, "uploadId", &upload_id),
                    HeaderMap::new(),
                    None,
                )
                .await;
            return self
                .checked(
                    Method::PUT,
                    base,
                    HeaderMap::new(),
                    Some(reqwest::Body::from(Vec::new())),
                )
                .await
                .map(|_| ());
        }
        let body = format!(
            "<CompleteMultipartUpload>{}</CompleteMultipartUpload>",
            etags
                .iter()
                .map(|(number, etag)| format!(
                    "<Part><PartNumber>{number}</PartNumber><ETag>{etag}</ETag></Part>"
                ))
                .collect::<String>()
        );
        self.checked(
            Method::POST,
            with_query(&base, "uploadId", &upload_id),
            HeaderMap::new(),
            Some(reqwest::Body::from(body)),
        )
        .await
        .map(|_| ())
    }

    pub fn presign_get_url(&self, key: &ObjectKey) -> Result<String, StorageError> {
        let mut url = self.url(key)?;
        let (access, secret) = self.config.credentials()?;
        let now = chrono::Utc::now();
        let date = now.format("%Y%m%d").to_string();
        let timestamp = now.format("%Y%m%dT%H%M%SZ").to_string();
        let scope = format!("{date}/{}/s3/aws4_request", self.config.region);
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
            query.append_pair("X-Amz-Credential", &format!("{access}/{scope}"));
            query.append_pair("X-Amz-Date", &timestamp);
            query.append_pair(
                "X-Amz-Expires",
                &self.config.presign_ttl.as_secs().to_string(),
            );
            query.append_pair("X-Amz-SignedHeaders", "host");
        }
        let canonical_request = format!(
            "GET\n{}\n{}\nhost:{}\n\nhost\nUNSIGNED-PAYLOAD",
            canonical_uri(&url),
            canonical_query(&url),
            url.host_str().ok_or(StorageError::InvalidUri)?
        );
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{timestamp}\n{scope}\n{}",
            hash_hex(canonical_request.as_bytes())
        );
        let signature = hex(&sign(
            signing_key(secret, &date, &self.config.region),
            string_to_sign.as_bytes(),
        ));
        url.query_pairs_mut()
            .append_pair("X-Amz-Signature", &signature);
        Ok(url.to_string())
    }
}

#[async_trait]
impl BlobStore for S3ObjectStorage {
    async fn head(&self, uri: &ArtifactUri) -> Result<ObjectMeta, StorageError> {
        let key = self.uri_key(uri)?;
        let response = self
            .checked(Method::HEAD, self.url(&key)?, HeaderMap::new(), None)
            .await?;
        let headers = response.headers();
        let size = headers
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
            .ok_or(StorageError::Protocol)?;
        Ok(ObjectMeta {
            size,
            etag: headers
                .get("etag")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned),
            ..ObjectMeta::default()
        })
    }

    async fn get_stream(&self, uri: &ArtifactUri) -> Result<BlobReader, StorageError> {
        let key = self.uri_key(uri)?;
        let response = self
            .checked(Method::GET, self.url(&key)?, HeaderMap::new(), None)
            .await?;
        let stream = response
            .bytes_stream()
            .map_err(|_| io::Error::other("s3 stream"));
        Ok(Box::pin(StreamReader::new(stream)))
    }

    async fn get_range(
        &self,
        uri: &ArtifactUri,
        range: ByteRange,
    ) -> Result<BlobReader, StorageError> {
        let key = self.uri_key(uri)?;
        let mut headers = HeaderMap::new();
        headers.insert(
            "range",
            format!("bytes={}-{}", range.start, range.end)
                .parse()
                .map_err(|_| StorageError::Protocol)?,
        );
        let response = self
            .checked(Method::GET, self.url(&key)?, headers, None)
            .await?;
        let stream = response
            .bytes_stream()
            .map_err(|_| io::Error::other("s3 stream"));
        Ok(Box::pin(StreamReader::new(stream)))
    }

    async fn put_stream(
        &self,
        key: &ObjectKey,
        reader: &mut (dyn AsyncRead + Send + Unpin),
    ) -> Result<ArtifactUri, StorageError> {
        self.multipart_put(key, reader).await?;
        Ok(ArtifactUri::S3 {
            bucket: self.config.bucket.clone(),
            key: key.clone(),
        })
    }

    async fn delete(&self, uri: &ArtifactUri) -> Result<(), StorageError> {
        let key = self.uri_key(uri)?;
        self.checked(Method::DELETE, self.url(&key)?, HeaderMap::new(), None)
            .await
            .map(|_| ())
    }

    async fn exists(&self, uri: &ArtifactUri) -> Result<bool, StorageError> {
        match self.head(uri).await {
            Ok(_) => Ok(true),
            Err(StorageError::Http) => Ok(false),
            Err(error) => Err(error),
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

    async fn presign_get(&self, uri: &ArtifactUri) -> Result<String, StorageError> {
        self.presign_get_url(&self.uri_key(uri)?)
    }
}

fn parse_credentials(file: &str) -> Option<(String, String)> {
    let mut access = None;
    let mut secret = None;
    let mut profile = false;
    for line in file.lines().map(str::trim) {
        if line.starts_with('[') {
            profile = line == "[default]";
            continue;
        }
        if !profile {
            continue;
        }
        if let Some(value) = line.strip_prefix("aws_access_key_id = ") {
            access = Some(value.to_owned());
        }
        if let Some(value) = line.strip_prefix("aws_secret_access_key = ") {
            secret = Some(value.to_owned());
        }
    }
    access.zip(secret)
}

fn env_bool(name: &str) -> bool {
    env::var(name).is_ok_and(|v| matches!(v.as_str(), "1" | "true" | "yes"))
}
fn env_duration(name: &str, default: u64) -> Duration {
    Duration::from_secs(
        env::var(name)
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|v: &u64| *v > 0)
            .unwrap_or(default),
    )
}
fn is_retryable(status: reqwest::StatusCode) -> bool {
    status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS
}
fn with_query(url: &Url, key: &str, value: &str) -> Url {
    with_query_pair(url, key, value, "", "")
}
fn with_query_pair(url: &Url, key: &str, value: &str, key2: &str, value2: &str) -> Url {
    let mut next = url.clone();
    let mut query = next.query_pairs_mut();
    query.append_pair(key, value);
    if !key2.is_empty() {
        query.append_pair(key2, value2);
    }
    drop(query);
    next
}
fn xml_tag(body: &[u8], tag: &str) -> Option<String> {
    let start = format!("<{tag}>");
    let end = format!("</{tag}>");
    let text = std::str::from_utf8(body).ok()?;
    Some(text.split_once(&start)?.1.split_once(&end)?.0.to_owned())
}
fn hash_hex(value: &[u8]) -> String {
    hex(&Sha256::digest(value))
}
fn hex(value: &[u8]) -> String {
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn sign(key: Vec<u8>, value: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(&key).expect("hmac key");
    mac.update(value);
    mac.finalize().into_bytes().to_vec()
}
fn signing_key(secret: &str, date: &str, region: &str) -> Vec<u8> {
    let k_date = sign(format!("AWS4{secret}").into_bytes(), date.as_bytes());
    let k_region = sign(k_date, region.as_bytes());
    let k_service = sign(k_region, b"s3");
    sign(k_service, b"aws4_request")
}
fn canonical_uri(url: &Url) -> String {
    if url.path().is_empty() {
        "/".into()
    } else {
        url.path().into()
    }
}
fn canonical_query(url: &Url) -> String {
    let mut values: Vec<_> = url
        .query_pairs()
        .map(|(key, value)| {
            (
                percent_encode(key.as_bytes()),
                percent_encode(value.as_bytes()),
            )
        })
        .collect();
    values.sort();
    values
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}
fn percent_encode(value: &[u8]) -> String {
    value
        .iter()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                (*byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

fn sign_request(request: &mut Request, config: &S3Config) -> Result<(), StorageError> {
    let (access, secret) = config.credentials()?;
    let now = chrono::Utc::now();
    let date = now.format("%Y%m%d").to_string();
    let timestamp = now.format("%Y%m%dT%H%M%SZ").to_string();
    request.headers_mut().insert(
        "x-amz-date",
        timestamp.parse().map_err(|_| StorageError::Protocol)?,
    );
    request.headers_mut().insert(
        "x-amz-content-sha256",
        "UNSIGNED-PAYLOAD"
            .parse()
            .map_err(|_| StorageError::Protocol)?,
    );
    if let Some(token) = &config.session_token {
        request.headers_mut().insert(
            "x-amz-security-token",
            token.parse().map_err(|_| StorageError::Protocol)?,
        );
    }
    let host = request.url().host_str().ok_or(StorageError::InvalidUri)?;
    let scope = format!("{date}/{}/{}/aws4_request", config.region, "s3");
    let canonical_headers = format!(
        "host:{host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:{}\n",
        timestamp
    );
    let signed_headers = "host;x-amz-content-sha256;x-amz-date";
    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        request.method(),
        canonical_uri(request.url()),
        canonical_query(request.url()),
        canonical_headers,
        signed_headers,
        "UNSIGNED-PAYLOAD"
    );
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{timestamp}\n{scope}\n{}",
        hash_hex(canonical_request.as_bytes())
    );
    let signature = hex(&sign(
        signing_key(secret, &date, &config.region),
        string_to_sign.as_bytes(),
    ));
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={access}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    );
    request.headers_mut().insert(
        "authorization",
        authorization.parse().map_err(|_| StorageError::Protocol)?,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{S3Config, percent_encode};
    #[test]
    fn encodes_unicode_keys_for_sigv4() {
        assert_eq!(
            percent_encode("黑色素瘤/data".as_bytes()),
            "%E9%BB%91%E8%89%B2%E7%B4%A0%E7%98%A4%2Fdata"
        );
    }
    #[test]
    fn config_does_not_require_credentials_until_auth() {
        let config = S3Config::from_env("bucket").unwrap();
        assert!(config.access_key.is_none() || config.secret_key.is_some());
    }
}
