use http::HeaderMap;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Guest,
    User,
    Admin,
}

#[derive(Debug, Clone, Serialize)]
pub struct Principal {
    pub role: Role,
    pub user_id: Option<String>,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Claims {
    sub: String,
    role: Role,
    #[serde(rename = "exp")]
    _exp: usize,
    #[serde(default)]
    scopes: Vec<String>,
}

pub fn issue_token(
    secret: &str,
    user_id: String,
    role: Role,
    expires_at: usize,
    scopes: Vec<String>,
) -> Result<String, jsonwebtoken::errors::Error> {
    encode(
        &Header::default(),
        &Claims {
            sub: user_id,
            role,
            _exp: expires_at,
            scopes,
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
        let is_admin = admin_key.is_some_and(|expected| {
            headers
                .get("x-shennong-admin-key")
                .is_some_and(|provided| provided.as_bytes() == expected.as_bytes())
        });
        if is_admin {
            return Self {
                role: Role::Admin,
                user_id: None,
                scopes: vec!["*".into()],
            };
        }
        let token = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "));
        if let (Some(token), Some(secret)) = (token, jwt_secret) {
            let mut validation = Validation::new(Algorithm::HS256);
            validation.validate_exp = true;
            if let Ok(data) = decode::<Claims>(
                token,
                &DecodingKey::from_secret(secret.as_bytes()),
                &validation,
            ) {
                return Self {
                    role: data.claims.role,
                    user_id: Some(data.claims.sub),
                    scopes: data.claims.scopes,
                };
            }
        }
        Self {
            role: Role::Guest,
            user_id: None,
            scopes: vec![],
        }
    }

    pub fn has_scopes(&self, required: &[String]) -> bool {
        self.scopes.iter().any(|scope| scope == "*")
            || required
                .iter()
                .all(|scope| self.scopes.iter().any(|candidate| candidate == scope))
    }
}

#[cfg(test)]
mod tests {
    use super::{Principal, Role, issue_token};
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
}
