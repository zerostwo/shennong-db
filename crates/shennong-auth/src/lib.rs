use hmac::{Hmac, Mac};
use http::HeaderMap;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::Digest;
use sha2::Sha256;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;
type HmacSha1 = Hmac<Sha1>;

const PBKDF2_ROUNDS: u32 = 120_000;
pub const TOKEN_ISSUER: &str = "shennong-db";
pub const TOKEN_AUDIENCE: &str = "shennong-api";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Guest,
    User,
    Admin,
}

pub fn hash_password(password: &str) -> String {
    let salt = *Uuid::new_v4().as_bytes();
    let digest = pbkdf2(password.as_bytes(), &salt, PBKDF2_ROUNDS);
    format!(
        "pbkdf2-sha256${PBKDF2_ROUNDS}${}${}",
        hex(&salt),
        hex(&digest)
    )
}

pub fn verify_password(password: &str, encoded: &str) -> bool {
    let parts: Vec<_> = encoded.split('$').collect();
    if parts.len() != 4 || parts[0] != "pbkdf2-sha256" {
        return false;
    }
    let Ok(rounds) = parts[1].parse::<u32>() else {
        return false;
    };
    let Some(salt) = unhex(parts[2]) else {
        return false;
    };
    let Some(expected) = unhex(parts[3]) else {
        return false;
    };
    constant_time_eq(&pbkdf2(password.as_bytes(), &salt, rounds), &expected)
}

fn pbkdf2(password: &[u8], salt: &[u8], rounds: u32) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(password).expect("HMAC accepts every key length");
    mac.update(salt);
    mac.update(&1_u32.to_be_bytes());
    let mut previous = mac.finalize().into_bytes().to_vec();
    let mut output = previous.clone();
    for _ in 1..rounds {
        let mut mac = HmacSha256::new_from_slice(password).expect("HMAC accepts every key length");
        mac.update(&previous);
        previous = mac.finalize().into_bytes().to_vec();
        for (left, right) in output.iter_mut().zip(&previous) {
            *left ^= right;
        }
    }
    output
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0_u8, |value, (a, b)| value | (a ^ b))
            == 0
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn unhex(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

pub fn verify_totp(secret: &str, code: &str, unix_seconds: u64) -> bool {
    if code.len() != 6 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let secret = unhex(secret).unwrap_or_else(|| secret.as_bytes().to_vec());
    let counter = unix_seconds / 30;
    for offset in [-1_i64, 0, 1] {
        let value = if offset.is_negative() {
            counter.saturating_sub(offset.unsigned_abs())
        } else {
            counter.saturating_add(offset as u64)
        };
        let Ok(mut mac) = HmacSha1::new_from_slice(&secret) else {
            return false;
        };
        mac.update(&value.to_be_bytes());
        let digest = mac.finalize().into_bytes();
        let index = (digest[19] & 0x0f) as usize;
        let number = (u32::from(digest[index]) & 0x7f) << 24
            | u32::from(digest[(index + 1) % digest.len()]) << 16
            | u32::from(digest[(index + 2) % digest.len()]) << 8
            | u32::from(digest[(index + 3) % digest.len()]);
        if format!("{:06}", number % 1_000_000) == code {
            return true;
        }
    }
    false
}

#[derive(Debug, Clone, Serialize)]
pub struct Principal {
    pub role: Role,
    pub user_id: Option<String>,
    pub scopes: Vec<String>,
    pub token_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Claims {
    sub: String,
    role: Role,
    #[serde(rename = "exp")]
    _exp: usize,
    #[serde(default)]
    scopes: Vec<String>,
    iat: usize,
    jti: String,
    iss: String,
    aud: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    nbf: Option<usize>,
}

pub fn issue_token(
    secret: &str,
    user_id: String,
    role: Role,
    expires_at: usize,
    scopes: Vec<String>,
) -> Result<String, jsonwebtoken::errors::Error> {
    let issued_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as usize;
    encode(
        &Header::default(),
        &Claims {
            sub: user_id,
            role,
            _exp: expires_at,
            scopes,
            iat: issued_at,
            jti: Uuid::new_v4().to_string(),
            iss: TOKEN_ISSUER.into(),
            aud: TOKEN_AUDIENCE.into(),
            nbf: None,
        },
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

impl Principal {
    pub fn from_headers(
        headers: &HeaderMap,
        admin_key: Option<&str>,
        jwt_secret: Option<&str>,
    ) -> Self {
        Self::from_headers_with_previous(headers, admin_key, jwt_secret, None)
    }

    pub fn from_headers_with_previous(
        headers: &HeaderMap,
        admin_key: Option<&str>,
        jwt_secret: Option<&str>,
        previous_secret: Option<&str>,
    ) -> Self {
        let is_admin = admin_key.is_some_and(|expected| {
            headers
                .get("x-shennong-admin-key")
                .is_some_and(|provided| constant_time_eq(provided.as_bytes(), expected.as_bytes()))
        });
        if is_admin {
            return Self {
                role: Role::Admin,
                user_id: None,
                scopes: vec!["*".into()],
                token_hash: None,
            };
        }
        let token = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .or_else(|| {
                headers
                    .get("cookie")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|cookies| {
                        cookies
                            .split(';')
                            .map(str::trim)
                            .find_map(|cookie| cookie.strip_prefix("shennong_session="))
                    })
            });
        if let Some(token) = token {
            let mut validation = Validation::new(Algorithm::HS256);
            validation.validate_exp = true;
            validation.leeway = 30;
            validation.set_issuer(&[TOKEN_ISSUER]);
            validation.set_audience(&[TOKEN_AUDIENCE]);
            for secret in [jwt_secret, previous_secret].into_iter().flatten() {
                if let Ok(data) = decode::<Claims>(
                    token,
                    &DecodingKey::from_secret(secret.as_bytes()),
                    &validation,
                ) {
                    return Self {
                        role: data.claims.role,
                        user_id: Some(data.claims.sub),
                        scopes: data.claims.scopes,
                        token_hash: Some(token_fingerprint(token)),
                    };
                }
            }
        }
        Self {
            role: Role::Guest,
            user_id: None,
            scopes: vec![],
            token_hash: None,
        }
    }

    pub fn has_scopes(&self, required: &[String]) -> bool {
        self.scopes.iter().any(|scope| scope == "*")
            || required
                .iter()
                .all(|scope| self.scopes.iter().any(|candidate| candidate == scope))
    }
}

pub fn token_fingerprint(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::{
        Claims, Principal, Role, TOKEN_AUDIENCE, TOKEN_ISSUER, hash_password, issue_token,
        verify_password,
    };
    use http::HeaderMap;

    #[test]
    fn wildcard_scope_matches_every_required_scope() {
        let guest = Principal::from_headers(&HeaderMap::new(), Some("admin-key"), None);
        assert!(!guest.has_scopes(&["resource.read".into()]));

        let mut headers = HeaderMap::new();
        headers.insert("x-shennong-admin-key", "admin-key".parse().unwrap());
        let admin = Principal::from_headers(&headers, Some("admin-key"), None);
        assert_eq!(admin.role, Role::Admin);
        assert!(admin.has_scopes(&["resource.read".into(), "resource.secret".into()]));
    }

    #[test]
    fn parses_a_valid_bearer_jwt() {
        let token = issue_token(
            "jwt-secret",
            "user-1".into(),
            Role::User,
            4_102_444_800,
            vec!["resource.read".into()],
        )
        .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
        let principal = Principal::from_headers(&headers, None, Some("jwt-secret"));
        assert_eq!(principal.role, Role::User);
        assert_eq!(principal.user_id.as_deref(), Some("user-1"));
    }

    #[test]
    fn password_hash_round_trip_rejects_wrong_password() {
        let encoded = hash_password("a-long-password");
        assert!(verify_password("a-long-password", &encoded));
        assert!(!verify_password("wrong-password", &encoded));
    }

    #[test]
    fn issuer_audience_and_expiration_are_required() {
        let token = jsonwebtoken::encode(
            &jsonwebtoken::Header::default(),
            &Claims {
                sub: "user".into(),
                role: Role::User,
                _exp: 1,
                scopes: vec!["resource.read".into()],
                iat: 1,
                jti: "jti".into(),
                iss: TOKEN_ISSUER.into(),
                aud: "wrong-audience".into(),
                nbf: None,
            },
            &jsonwebtoken::EncodingKey::from_secret(b"secret"),
        )
        .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
        assert_eq!(
            Principal::from_headers(&headers, None, Some("secret")).role,
            Role::Guest
        );
        assert_eq!(TOKEN_AUDIENCE, "shennong-api");
    }
}
