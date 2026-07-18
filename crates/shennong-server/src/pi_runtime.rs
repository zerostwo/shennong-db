#![allow(dead_code)]

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{env, time::Duration};

#[derive(Clone)]
pub(super) struct PiRuntimeClient {
    client: reqwest::Client,
    endpoint: String,
    secret: String,
}

#[derive(Serialize)]
pub(super) struct PiProviderCredential<'a> {
    pub kind: &'a str,
    pub base_url: &'a str,
    pub model: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<&'a str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<&'a str>,
}

#[derive(Serialize)]
pub(super) struct PiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
pub(super) struct PiToolPolicy {
    pub allow_private: bool,
    pub allow_data_write: bool,
    pub is_admin: bool,
}

#[derive(Serialize)]
pub(super) struct PiRunRequest<'a> {
    pub run_id: &'a str,
    pub provider: PiProviderCredential<'a>,
    pub provider_id: &'a str,
    pub system_prompt: &'a str,
    pub messages: Vec<PiMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_level: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_callback_token: Option<&'a str>,
    pub tools_enabled: bool,
    pub tool_policy: PiToolPolicy,
    pub attached_upload_ids: Vec<&'a str>,
    pub timeout_ms: u64,
}

#[derive(Clone, Deserialize)]
pub(super) struct PiRunResult {
    pub run_id: String,
    pub content: String,
    #[serde(default)]
    pub reasoning: String,
    #[serde(default)]
    pub tool_events: Vec<Value>,
    pub usage: Option<Value>,
    pub stop_reason: String,
    pub model: String,
    pub provider: String,
}

#[derive(Deserialize)]
struct RuntimeEnvelope {
    data: PiRunResult,
}

#[derive(Debug, thiserror::Error)]
pub(super) enum PiRuntimeError {
    #[error("pi runtime is not configured")]
    NotConfigured,
    #[error("pi runtime request failed")]
    Transport(reqwest::Error),
    #[error("pi runtime returned an invalid protocol response")]
    Protocol(reqwest::Error),
    #[error("pi runtime rejected the run ({0})")]
    Rejected(StatusCode),
}

impl PiRuntimeClient {
    pub(super) fn from_env(client: reqwest::Client) -> Result<Option<Self>, PiRuntimeError> {
        let enabled = env::var("SHENNONG_AGENT_RUNTIME_ENABLED")
            .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes"))
            .unwrap_or(false);
        if !enabled {
            return Ok(None);
        }
        let secret = env::var("SHENNONG_AGENT_RUNTIME_SECRET")
            .ok()
            .filter(|value| value.len() >= 32)
            .ok_or(PiRuntimeError::NotConfigured)?;
        let endpoint = env::var("SHENNONG_AGENT_RUNTIME_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8002".into());
        if !endpoint.starts_with("http://127.0.0.1:") && !endpoint.starts_with("http://[::1]:") {
            return Err(PiRuntimeError::NotConfigured);
        }
        Ok(Some(Self {
            client,
            endpoint: endpoint.trim_end_matches('/').to_owned(),
            secret,
        }))
    }

    pub(super) async fn run(
        &self,
        request: &PiRunRequest<'_>,
    ) -> Result<PiRunResult, PiRuntimeError> {
        let response = self
            .client
            .post(format!("{}/v1/runs", self.endpoint))
            .bearer_auth(&self.secret)
            .timeout(Duration::from_millis(
                request.timeout_ms.saturating_add(5_000),
            ))
            .json(request)
            .send()
            .await
            .map_err(PiRuntimeError::Transport)?;
        if !response.status().is_success() {
            return Err(PiRuntimeError::Rejected(response.status()));
        }
        Ok(response
            .json::<RuntimeEnvelope>()
            .await
            .map_err(PiRuntimeError::Protocol)?
            .data)
    }

    pub(super) fn authorizes(&self, provided: Option<&str>) -> bool {
        let Some(provided) = provided else {
            return false;
        };
        if provided.len() != self.secret.len() {
            return false;
        }
        provided
            .as_bytes()
            .iter()
            .zip(self.secret.as_bytes())
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            })
            == 0
    }
}

#[cfg(test)]
mod tests {
    use super::{PiProviderCredential, PiRunRequest};

    #[test]
    fn provider_key_is_only_an_ephemeral_request_field() {
        let request = PiRunRequest {
            run_id: "run-test",
            provider: PiProviderCredential {
                kind: "deepseek",
                base_url: "https://api.deepseek.com",
                model: "deepseek-chat",
                api_key: Some("secret"),
                capabilities: vec!["tools"],
            },
            provider_id: "provider-test",
            system_prompt: "governed",
            messages: vec![],
            thinking_level: None,
            project_id: None,
            tool_callback_token: None,
            tools_enabled: false,
            tool_policy: super::PiToolPolicy {
                allow_private: false,
                allow_data_write: false,
                is_admin: false,
            },
            attached_upload_ids: vec![],
            timeout_ms: 1_000,
        };
        let json = serde_json::to_value(request).unwrap();
        assert_eq!(json["provider"]["api_key"], "secret");
        assert!(json.get("persist_credentials").is_none());
    }
}
