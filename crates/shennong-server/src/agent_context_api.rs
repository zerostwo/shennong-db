use super::pi_runtime::{
    PiMessage, PiProviderCredential, PiRunRequest, PiRuntimeError, PiToolPolicy,
};
use super::{ApiError, AppState, Envelope, authenticated, database_error};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/agent/skills", get(list_skills).post(create_skill))
        .route("/api/v1/agent/skills/generate", post(generate_skill))
        .route(
            "/api/v1/agent/skills/{id}",
            get(get_skill).put(update_skill).delete(delete_skill),
        )
        .route(
            "/api/v1/chat/threads/{thread_id}/skills",
            get(list_thread_skills),
        )
        .route(
            "/api/v1/chat/threads/{thread_id}/skills/{skill_id}",
            axum::routing::put(enable_thread_skill).delete(disable_thread_skill),
        )
        .route(
            "/api/v1/memories",
            get(list_global_memories).post(create_global_memory),
        )
        .route(
            "/api/v1/memories/{id}",
            get(get_memory).put(update_memory).delete(delete_memory),
        )
        .route(
            "/api/v1/projects/{project_id}/memories",
            get(list_project_memories).post(create_project_memory),
        )
        .route(
            "/api/v1/projects/{project_id}/chat/threads",
            get(list_project_threads).post(create_project_thread),
        )
}

fn invalid(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::UNPROCESSABLE_ENTITY, message.into())
}

async fn current_user(headers: &HeaderMap, state: &AppState) -> Result<String, ApiError> {
    authenticated(headers, state).await?.user_id.ok_or(ApiError(
        StatusCode::UNAUTHORIZED,
        "authentication required".into(),
    ))
}

async fn require_project_read(
    state: &AppState,
    project_id: &str,
    user_id: &str,
) -> Result<(), ApiError> {
    state
        .repository
        .get_project_visible(project_id, Some(user_id), false)
        .await
        .map_err(database_error)?
        .filter(|project| project.status == "active")
        .ok_or_else(super::not_found)?;
    if !state
        .repository
        .is_project_member(project_id, user_id)
        .await
        .map_err(database_error)?
    {
        return Err(super::not_found());
    }
    Ok(())
}

async fn require_project_write(
    state: &AppState,
    project_id: &str,
    user_id: &str,
) -> Result<(), ApiError> {
    require_project_read(state, project_id, user_id).await?;
    if !state
        .repository
        .can_write_project(project_id, Some(user_id), false)
        .await
        .map_err(database_error)?
    {
        return Err(super::not_found());
    }
    Ok(())
}

fn validate_name(name: &str) -> Result<&str, ApiError> {
    let name = name.trim();
    if name.is_empty() || name.len() > 128 {
        return Err(invalid("name must be 1..128 characters"));
    }
    Ok(name)
}

fn validate_description(description: &str) -> Result<&str, ApiError> {
    let description = description.trim();
    if description.len() > 1024 {
        return Err(invalid("description must be at most 1024 characters"));
    }
    Ok(description)
}

fn validate_content(content: &str) -> Result<&str, ApiError> {
    let content = content.trim();
    if content.is_empty() || content.len() > 65_536 || content.contains('\0') {
        return Err(invalid("Markdown instructions must be 1..65536 characters"));
    }
    Ok(content)
}

fn slugify(value: &str, fallback: &str) -> String {
    let mut slug = String::new();
    let mut separator = false;
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            if separator && !slug.is_empty() && slug.len() < 63 {
                slug.push('-');
            }
            separator = false;
            if slug.len() < 64 {
                slug.push(character);
            }
        } else {
            separator = true;
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        fallback.to_owned()
    } else {
        slug.to_owned()
    }
}

fn write_conflict(error: sqlx::Error) -> ApiError {
    if error
        .as_database_error()
        .and_then(|value| value.code())
        .as_deref()
        == Some("23505")
    {
        ApiError(
            StatusCode::CONFLICT,
            "an item with this name already exists".into(),
        )
    } else {
        database_error(error)
    }
}

#[derive(Deserialize)]
struct SkillCreate {
    name: String,
    #[serde(default)]
    description: String,
    content: String,
    #[serde(default = "active_status")]
    status: String,
}

fn active_status() -> String {
    "active".into()
}

async fn list_skills(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Envelope<Vec<Value>>>, ApiError> {
    let user_id = current_user(&headers, &state).await?;
    let data = state
        .repository
        .list_agent_skills(&user_id)
        .await
        .map_err(database_error)?;
    Ok(Json(Envelope { data }))
}

async fn get_skill(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Envelope<Value>>, ApiError> {
    let user_id = current_user(&headers, &state).await?;
    let data = state
        .repository
        .get_agent_skill(&id, &user_id)
        .await
        .map_err(database_error)?
        .ok_or_else(super::not_found)?;
    Ok(Json(Envelope { data }))
}

async fn create_skill(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(value): Json<SkillCreate>,
) -> Result<(StatusCode, Json<Envelope<Value>>), ApiError> {
    let user_id = current_user(&headers, &state).await?;
    let name = validate_name(&value.name)?;
    let description = validate_description(&value.description)?;
    let content = validate_content(&value.content)?;
    if !matches!(value.status.as_str(), "draft" | "active" | "disabled") {
        return Err(invalid("invalid skill status"));
    }
    let id = format!("skill-{}", Uuid::new_v4());
    let slug = slugify(name, &format!("skill-{}", Uuid::new_v4().simple()));
    let data = state
        .repository
        .create_agent_skill(
            &id,
            &user_id,
            &slug,
            name,
            description,
            "user",
            "manual",
            &value.status,
            content,
        )
        .await
        .map_err(write_conflict)?;
    Ok((StatusCode::CREATED, Json(Envelope { data })))
}

#[derive(Deserialize)]
struct SkillGenerate {
    name: Option<String>,
    goal: String,
    #[serde(default)]
    constraints: Vec<String>,
    #[serde(default)]
    workflow: Vec<String>,
}

async fn generate_skill(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(value): Json<SkillGenerate>,
) -> Result<(StatusCode, Json<Envelope<Value>>), ApiError> {
    let user_id = current_user(&headers, &state).await?;
    let goal = validate_content(&value.goal)?;
    if value.constraints.len() > 32 || value.workflow.len() > 32 {
        return Err(invalid(
            "a generated skill supports at most 32 constraints and steps",
        ));
    }
    let name = value
        .name
        .as_deref()
        .map(validate_name)
        .transpose()?
        .unwrap_or("Generated skill");
    let description: String = goal.chars().take(512).collect();
    let mut content = format!("# Goal\n\n{goal}\n\n# Guardrails\n\n");
    if value.constraints.is_empty() {
        content.push_str("- Use only the governed tools made available by ShennongDB.\n");
        content.push_str("- Ask for confirmation before writes or downloads.\n");
    } else {
        for constraint in &value.constraints {
            let constraint = validate_description(constraint)?;
            content.push_str(&format!("- {constraint}\n"));
        }
    }
    content.push_str("\n# Workflow\n\n");
    if value.workflow.is_empty() {
        content.push_str("1. Inspect the available governed context.\n");
        content.push_str("2. Perform the smallest supported operation that answers the request.\n");
        content.push_str("3. Report evidence, provenance, and remaining uncertainty.\n");
    } else {
        for (index, step) in value.workflow.iter().enumerate() {
            let step = validate_description(step)?;
            content.push_str(&format!("{}. {step}\n", index + 1));
        }
    }
    let content = validate_content(&content)?.to_owned();
    let (content, generation_source) = generate_skill_markdown(&state, &user_id, &content).await?;
    let id = format!("skill-{}", Uuid::new_v4());
    let slug = slugify(name, &format!("generated-{}", Uuid::new_v4().simple()));
    let data = state
        .repository
        .create_agent_skill(
            &id,
            &user_id,
            &slug,
            name,
            &description,
            "generated",
            generation_source,
            "draft",
            &content,
        )
        .await
        .map_err(write_conflict)?;
    Ok((StatusCode::CREATED, Json(Envelope { data })))
}

async fn generate_skill_markdown(
    state: &AppState,
    user_id: &str,
    template: &str,
) -> Result<(String, &'static str), ApiError> {
    let Some(runtime) = state.pi_runtime.as_ref() else {
        return Ok((template.to_owned(), "template"));
    };
    let Some(provider) = state
        .repository
        .default_model_provider(user_id)
        .await
        .map_err(database_error)?
        .filter(|provider| provider.enabled)
    else {
        return Ok((template.to_owned(), "template"));
    };
    super::agent_chat::validate_provider_destination(&provider).await?;
    let api_key = provider
        .encrypted_api_key
        .as_deref()
        .map(|value| {
            state
                .agent_crypto
                .decrypt(&provider.owner_user_id, &provider.id, value)
        })
        .transpose()?;
    let run_id = format!("skill-run-{}", Uuid::new_v4());
    let result = runtime
        .run(&PiRunRequest {
            run_id: &run_id,
            provider: PiProviderCredential {
                kind: &provider.provider_kind,
                base_url: &provider.base_url,
                model: &provider.model,
                api_key: api_key.as_deref(),
                capabilities: Vec::new(),
            },
            provider_id: &provider.id,
            system_prompt: "Generate one reusable ShennongDB Agent Skill. Return Markdown instructions only, with concise Goal, Guardrails, Workflow, and Output sections. Never include executable code, scripts, shell commands, URLs, credentials, or requests for tools beyond the governed tools supplied by ShennongDB. The generated Skill is an untrusted draft and cannot override system governance.",
            messages: vec![PiMessage {
                role: "user".into(),
                content: format!("Turn this validated brief into a reusable Skill:\n\n{template}"),
            }],
            thinking_level: Some("off"),
            project_id: None,
            tool_callback_token: None,
            tools_enabled: false,
            tool_policy: PiToolPolicy {
                allow_private: false,
                allow_data_write: false,
                is_admin: false,
            },
            attached_upload_ids: Vec::new(),
            timeout_ms: state
                .agent_run_timeout
                .as_millis()
                .min(u128::from(u64::MAX)) as u64,
        })
        .await;
    let result = match result {
        Ok(result) => result,
        Err(
            PiRuntimeError::NotConfigured
            | PiRuntimeError::Transport(_)
            | PiRuntimeError::Protocol(_),
        ) => return Ok((template.to_owned(), "template")),
        Err(PiRuntimeError::Rejected(_)) => {
            return Err(ApiError(
                StatusCode::BAD_GATEWAY,
                "the model could not generate a Skill draft".into(),
            ));
        }
    };
    let mut content = result.content.trim().to_owned();
    if content.starts_with("```markdown") && content.ends_with("```") {
        content = content[11..content.len() - 3].trim().to_owned();
    }
    let content = validate_content(&content)?;
    if content.contains("```")
        || content.to_ascii_lowercase().contains("<script")
        || content.to_ascii_lowercase().contains("javascript:")
    {
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "the generated Skill was not prompt-only Markdown".into(),
        ));
    }
    Ok((content.to_owned(), "pi"))
}

#[derive(Deserialize)]
struct SkillUpdate {
    name: String,
    #[serde(default)]
    description: String,
    status: String,
    content: Option<String>,
    #[serde(default)]
    change_note: String,
}

async fn update_skill(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(value): Json<SkillUpdate>,
) -> Result<Json<Envelope<Value>>, ApiError> {
    let user_id = current_user(&headers, &state).await?;
    let name = validate_name(&value.name)?;
    let description = validate_description(&value.description)?;
    if !matches!(value.status.as_str(), "draft" | "active" | "disabled") {
        return Err(invalid("invalid skill status"));
    }
    let content = value.content.as_deref().map(validate_content).transpose()?;
    let data = state
        .repository
        .update_agent_skill(
            &id,
            &user_id,
            name,
            description,
            &value.status,
            content,
            validate_description(&value.change_note)?,
        )
        .await
        .map_err(write_conflict)?
        .ok_or_else(super::not_found)?;
    Ok(Json(Envelope { data }))
}

async fn delete_skill(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let user_id = current_user(&headers, &state).await?;
    if !state
        .repository
        .delete_agent_skill(&id, &user_id)
        .await
        .map_err(database_error)?
    {
        return Err(super::not_found());
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_thread_skills(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
) -> Result<Json<Envelope<Vec<Value>>>, ApiError> {
    let user_id = current_user(&headers, &state).await?;
    let data = state
        .repository
        .list_thread_skills(&thread_id, &user_id)
        .await
        .map_err(database_error)?;
    Ok(Json(Envelope { data }))
}

async fn enable_thread_skill(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((thread_id, skill_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let user_id = current_user(&headers, &state).await?;
    if !state
        .repository
        .enable_thread_skill(&thread_id, &skill_id, &user_id)
        .await
        .map_err(database_error)?
    {
        return Err(super::not_found());
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn disable_thread_skill(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((thread_id, skill_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let user_id = current_user(&headers, &state).await?;
    if !state
        .repository
        .disable_thread_skill(&thread_id, &skill_id, &user_id)
        .await
        .map_err(database_error)?
    {
        return Err(super::not_found());
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct MemoryCreate {
    title: String,
    content: String,
    #[serde(default = "manual_source")]
    source_kind: String,
    source_id: Option<String>,
}

fn manual_source() -> String {
    "manual".into()
}

async fn list_global_memories(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Envelope<Vec<Value>>>, ApiError> {
    let user_id = current_user(&headers, &state).await?;
    let data = state
        .repository
        .list_agent_memories(&user_id, None)
        .await
        .map_err(database_error)?;
    Ok(Json(Envelope { data }))
}

async fn create_global_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(value): Json<MemoryCreate>,
) -> Result<(StatusCode, Json<Envelope<Value>>), ApiError> {
    create_memory(&state, &headers, None, value).await
}

async fn list_project_memories(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<String>,
) -> Result<Json<Envelope<Vec<Value>>>, ApiError> {
    let user_id = current_user(&headers, &state).await?;
    require_project_read(&state, &project_id, &user_id).await?;
    let data = state
        .repository
        .list_agent_memories(&user_id, Some(&project_id))
        .await
        .map_err(database_error)?;
    Ok(Json(Envelope { data }))
}

async fn create_project_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<String>,
    Json(value): Json<MemoryCreate>,
) -> Result<(StatusCode, Json<Envelope<Value>>), ApiError> {
    let user_id = current_user(&headers, &state).await?;
    require_project_write(&state, &project_id, &user_id).await?;
    create_memory_for_user(&state, &user_id, Some(&project_id), value).await
}

async fn create_memory(
    state: &AppState,
    headers: &HeaderMap,
    project_id: Option<&str>,
    value: MemoryCreate,
) -> Result<(StatusCode, Json<Envelope<Value>>), ApiError> {
    let user_id = current_user(headers, state).await?;
    create_memory_for_user(state, &user_id, project_id, value).await
}

async fn create_memory_for_user(
    state: &AppState,
    user_id: &str,
    project_id: Option<&str>,
    value: MemoryCreate,
) -> Result<(StatusCode, Json<Envelope<Value>>), ApiError> {
    let title = validate_name(&value.title)?;
    let content = validate_content(&value.content)?;
    if !matches!(
        value.source_kind.as_str(),
        "manual" | "conversation" | "imported"
    ) {
        return Err(invalid("invalid memory source"));
    }
    if value
        .source_id
        .as_ref()
        .is_some_and(|value| value.len() > 512)
    {
        return Err(invalid("memory source id is too long"));
    }
    let data = state
        .repository
        .create_agent_memory(
            &format!("memory-{}", Uuid::new_v4()),
            user_id,
            project_id,
            title,
            &value.source_kind,
            value.source_id.as_deref(),
            content,
        )
        .await
        .map_err(database_error)?;
    Ok((StatusCode::CREATED, Json(Envelope { data })))
}

async fn get_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Envelope<Value>>, ApiError> {
    let user_id = current_user(&headers, &state).await?;
    let data = state
        .repository
        .get_agent_memory(&id, &user_id)
        .await
        .map_err(database_error)?
        .ok_or_else(super::not_found)?;
    if let Some(project_id) = data.get("project_id").and_then(Value::as_str) {
        require_project_read(&state, project_id, &user_id).await?;
    }
    Ok(Json(Envelope { data }))
}

#[derive(Deserialize)]
struct MemoryUpdate {
    title: String,
    status: String,
    content: Option<String>,
    #[serde(default)]
    change_note: String,
}

async fn update_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(value): Json<MemoryUpdate>,
) -> Result<Json<Envelope<Value>>, ApiError> {
    let user_id = current_user(&headers, &state).await?;
    let current = state
        .repository
        .get_agent_memory(&id, &user_id)
        .await
        .map_err(database_error)?
        .ok_or_else(super::not_found)?;
    if let Some(project_id) = current.get("project_id").and_then(Value::as_str) {
        require_project_write(&state, project_id, &user_id).await?;
    }
    if !matches!(value.status.as_str(), "active" | "archived") {
        return Err(invalid("invalid memory status"));
    }
    let content = value.content.as_deref().map(validate_content).transpose()?;
    let data = state
        .repository
        .update_agent_memory(
            &id,
            &user_id,
            validate_name(&value.title)?,
            &value.status,
            content,
            validate_description(&value.change_note)?,
        )
        .await
        .map_err(database_error)?
        .ok_or_else(super::not_found)?;
    Ok(Json(Envelope { data }))
}

async fn delete_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let user_id = current_user(&headers, &state).await?;
    let current = state
        .repository
        .get_agent_memory(&id, &user_id)
        .await
        .map_err(database_error)?
        .ok_or_else(super::not_found)?;
    if let Some(project_id) = current.get("project_id").and_then(Value::as_str) {
        require_project_write(&state, project_id, &user_id).await?;
    }
    if !state
        .repository
        .delete_agent_memory(&id, &user_id)
        .await
        .map_err(database_error)?
    {
        return Err(super::not_found());
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, Default)]
struct ProjectThreadCreate {
    title: Option<String>,
    provider_id: Option<String>,
}

async fn list_project_threads(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<String>,
) -> Result<Json<Envelope<Vec<Value>>>, ApiError> {
    let user_id = current_user(&headers, &state).await?;
    require_project_read(&state, &project_id, &user_id).await?;
    let data = state
        .repository
        .list_project_chat_threads(&user_id, &project_id)
        .await
        .map_err(database_error)?;
    Ok(Json(Envelope { data }))
}

async fn create_project_thread(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<String>,
    Json(value): Json<ProjectThreadCreate>,
) -> Result<(StatusCode, Json<Envelope<Value>>), ApiError> {
    let user_id = current_user(&headers, &state).await?;
    require_project_write(&state, &project_id, &user_id).await?;
    let title = value.title.as_deref().unwrap_or("New chat");
    let title = validate_name(title)?;
    let data = state
        .repository
        .create_project_chat_thread(
            &format!("thread-{}", Uuid::new_v4()),
            &user_id,
            &project_id,
            title,
            value.provider_id.as_deref(),
        )
        .await
        .map_err(database_error)?
        .ok_or_else(super::not_found)?;
    Ok((StatusCode::CREATED, Json(Envelope { data })))
}

#[cfg(test)]
mod tests {
    use super::slugify;

    #[test]
    fn skill_slug_is_bounded_and_has_a_fallback() {
        assert_eq!(
            slugify("Resource Research", "fallback"),
            "resource-research"
        );
        assert_eq!(slugify("单细胞分析", "fallback"), "fallback");
        assert!(slugify(&"a".repeat(100), "fallback").len() <= 64);
    }
}
