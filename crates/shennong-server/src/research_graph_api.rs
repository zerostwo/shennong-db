use super::*;
use shennong_schema::{
    ActivityActorUpsert, ActivityIoUpsert, ActivityUpsert, AssociationEvidenceUpsert,
    EvidenceItemCreate, GraphAssociationUpsert, ProjectResourceBindingUpsert, ProjectUpsert,
    ResearchEntityUpsert, StudyUpsert,
};
use std::collections::HashSet;

const DEFAULT_GRAPH_DEPTH: u8 = 1;
const MAX_GRAPH_DEPTH: u8 = 3;
const DEFAULT_GRAPH_LIMIT: usize = 80;
const MAX_GRAPH_LIMIT: usize = 200;
const PROJECT_CONTEXT_LIMIT: i64 = 50;
const PROJECT_LIST_LIMIT: i64 = 500;

#[derive(serde::Deserialize)]
pub(super) struct GraphSubgraphQuery {
    root: String,
    depth: Option<u8>,
    limit: Option<usize>,
    #[serde(default)]
    project_id: Option<String>,
}

#[derive(serde::Deserialize)]
pub(super) struct GraphSearchRequest {
    q: String,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(serde::Deserialize)]
pub(super) struct AssociationEvidenceRequest {
    stance: String,
    #[serde(default)]
    weight: Option<f64>,
    #[serde(default)]
    note: Option<String>,
}

#[derive(serde::Deserialize, Default)]
pub(super) struct ProjectResourceRoleQuery {
    role: Option<String>,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProjectAccess {
    None,
    Read,
    Write,
}

#[cfg(test)]
fn project_access_level(
    role: Role,
    user_id: Option<&str>,
    owner_user_id: &str,
    visibility: &str,
    membership_role: Option<&str>,
) -> ProjectAccess {
    if role == Role::Admin {
        return ProjectAccess::Write;
    }
    if user_id.is_some_and(|user_id| user_id == owner_user_id)
        || matches!(membership_role, Some("owner" | "editor"))
    {
        return ProjectAccess::Write;
    }
    if visibility == "public" || membership_role == Some("viewer") {
        return ProjectAccess::Read;
    }
    ProjectAccess::None
}

fn graph_bounds(depth: Option<u8>, limit: Option<usize>) -> Result<(u8, usize), ApiError> {
    let depth = depth.unwrap_or(DEFAULT_GRAPH_DEPTH);
    let limit = limit.unwrap_or(DEFAULT_GRAPH_LIMIT);
    if !(1..=MAX_GRAPH_DEPTH).contains(&depth) {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "graph depth must be between 1 and 3".into(),
        ));
    }
    if !(1..=MAX_GRAPH_LIMIT).contains(&limit) {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "graph limit must be between 1 and 200".into(),
        ));
    }
    Ok((depth, limit))
}

fn belongs_to_project(actual_project_id: Option<&str>, expected_project_id: &str) -> bool {
    actual_project_id == Some(expected_project_id)
}

fn subgraph_within_project(subgraph: &shennong_schema::ResearchSubgraph, project_id: &str) -> bool {
    subgraph
        .entities
        .iter()
        .all(|entity| belongs_to_project(entity.project_id.as_deref(), project_id))
        && subgraph
            .associations
            .iter()
            .all(|association| belongs_to_project(association.project_id.as_deref(), project_id))
}

fn constrain_project_association(
    value: &mut GraphAssociationUpsert,
    project_id: &str,
    created_by: Option<&str>,
) {
    value.project_id = Some(project_id.to_owned());
    value.scope = "project".into();
    value.knowledge_level = "hypothesis".into();
    value.status = "proposed".into();
    value.created_by = created_by.map(str::to_owned);
}

async fn project_access(
    state: &AppState,
    headers: &HeaderMap,
    project_id: &str,
    write: bool,
) -> Result<(Principal, shennong_schema::Project), ApiError> {
    let actor = principal(headers, state);
    let actor = if write {
        match actor.role {
            Role::Admin => admin(headers, state).await?,
            Role::User => authenticated(headers, state).await?,
            Role::Guest => {
                return Err(ApiError(
                    StatusCode::UNAUTHORIZED,
                    "authentication required".into(),
                ));
            }
        }
    } else {
        actor
    };
    let project = state
        .repository
        .get_project_visible(
            project_id,
            actor.user_id.as_deref(),
            actor.role == Role::Admin,
        )
        .await
        .map_err(database_error)?
        .ok_or_else(not_found)?;
    if write
        && !state
            .repository
            .can_write_project(
                project_id,
                actor.user_id.as_deref(),
                actor.role == Role::Admin,
            )
            .await
            .map_err(database_error)?
    {
        return Err(not_found());
    }
    if write && project.status != "active" {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "archived projects are read-only".into(),
        ));
    }
    Ok((actor, project))
}

async fn graph_entity_visible(
    state: &AppState,
    headers: &HeaderMap,
    entity_id: &str,
) -> Result<shennong_schema::ResearchEntity, ApiError> {
    let entity = state
        .repository
        .get_research_entity(entity_id)
        .await
        .map_err(database_error)?
        .ok_or_else(not_found)?;
    if let Some(project_id) = entity.project_id.as_deref() {
        project_access(state, headers, project_id, false).await?;
    }
    Ok(entity)
}

async fn evidence_visible(
    state: &AppState,
    headers: &HeaderMap,
    selected_project_id: &str,
    evidence: &shennong_schema::EvidenceItem,
) -> Result<bool, ApiError> {
    if evidence
        .project_id
        .as_deref()
        .is_some_and(|project_id| project_id != selected_project_id)
    {
        return Ok(false);
    }
    let Some(source_id) = evidence.source_id.as_deref() else {
        return Ok(true);
    };
    if let Some(resource) = state
        .repository
        .get_resource(source_id)
        .await
        .map_err(database_error)?
    {
        return can_read(state, &principal(headers, state), &resource).await;
    }
    if state
        .repository
        .get_project(source_id)
        .await
        .map_err(database_error)?
        .is_some()
    {
        return Ok(state
            .repository
            .get_project_visible(
                source_id,
                principal(headers, state).user_id.as_deref(),
                principal(headers, state).role == Role::Admin,
            )
            .await
            .map_err(database_error)?
            .is_some());
    }
    Ok(true)
}

pub(super) async fn list_projects(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Envelope<Vec<shennong_schema::Project>>>, ApiError> {
    let actor = principal(&headers, &state);
    let data = state
        .repository
        .list_projects(actor.user_id.as_deref(), actor.role == Role::Admin)
        .await
        .map_err(database_error)?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn create_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut value): Json<ProjectUpsert>,
) -> Result<Json<Envelope<shennong_schema::Project>>, ApiError> {
    let actor = authenticated(&headers, &state).await?;
    value.owner_user_id = actor.user_id.clone().unwrap_or_default();
    if value.id.trim().is_empty() {
        value.id = format!("project-{}", uuid::Uuid::new_v4());
    }
    validate_project(&value)?;
    let data = state
        .repository
        .create_project(&value)
        .await
        .map_err(database_error)?;
    audit(
        &state,
        &headers,
        "project.create",
        "project",
        &data.id,
        serde_json::json!({"visibility": data.visibility}),
    )
    .await?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn sync_external_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(value): Json<ProjectUpsert>,
) -> Result<Json<Envelope<shennong_schema::Project>>, ApiError> {
    let actor = admin(&headers, &state).await?;
    require_service_principal(&actor)?;
    validate_external_project_sync(&id, &value)?;
    let data = state
        .repository
        .sync_external_project(&value)
        .await
        .map_err(database_error)?;
    audit(
        &state,
        &headers,
        "project.shadow_sync",
        "project",
        &data.id,
        serde_json::json!({"authority":"shennong-os"}),
    )
    .await?;
    Ok(Json(Envelope { data }))
}

fn require_service_principal(actor: &Principal) -> Result<(), ApiError> {
    if actor.role != Role::Admin || actor.user_id.is_some() {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "database service authentication is required".into(),
        ));
    }
    Ok(())
}

fn validate_external_project_sync(id: &str, value: &ProjectUpsert) -> Result<(), ApiError> {
    if value.id != id {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "project id must match request path".into(),
        ));
    }
    validate_project(value)
}

pub(super) async fn get_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Envelope<shennong_schema::Project>>, ApiError> {
    let (_, data) = project_access(&state, &headers, &id, false).await?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn list_project_entities(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Envelope<Vec<shennong_schema::ResearchEntity>>>, ApiError> {
    project_access(&state, &headers, &id, false).await?;
    let data = state
        .repository
        .list_research_entities(&id, None, None, PROJECT_LIST_LIMIT)
        .await
        .map_err(database_error)?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn upsert_project_entity(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut value): Json<ResearchEntityUpsert>,
) -> Result<Json<Envelope<shennong_schema::ResearchEntity>>, ApiError> {
    project_access(&state, &headers, &id, true).await?;
    value.project_id = Some(id.clone());
    validate_research_entity(&value, &id)?;
    let data = state
        .repository
        .upsert_research_entity(&value)
        .await
        .map_err(database_error)?;
    audit(
        &state,
        &headers,
        "research_entity.upsert",
        "research_entity",
        &data.id,
        serde_json::json!({"project_id": id}),
    )
    .await?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn list_project_activities(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Envelope<Vec<shennong_schema::Activity>>>, ApiError> {
    project_access(&state, &headers, &id, false).await?;
    let data = state
        .repository
        .list_activities(&id, None, None, PROJECT_LIST_LIMIT)
        .await
        .map_err(database_error)?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn upsert_project_activity(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut value): Json<ActivityUpsert>,
) -> Result<Json<Envelope<shennong_schema::Activity>>, ApiError> {
    project_access(&state, &headers, &id, true).await?;
    value.project_id = id.clone();
    validate_activity(&value, &id)?;
    let data = state
        .repository
        .upsert_activity(&value)
        .await
        .map_err(database_error)?;
    audit(
        &state,
        &headers,
        "research_activity.upsert",
        "research_activity",
        &data.id,
        serde_json::json!({"project_id": id}),
    )
    .await?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn list_project_studies(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Envelope<Vec<shennong_schema::Study>>>, ApiError> {
    project_access(&state, &headers, &id, false).await?;
    let data = state
        .repository
        .list_studies(&id, PROJECT_LIST_LIMIT)
        .await
        .map_err(database_error)?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn upsert_project_study(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut value): Json<StudyUpsert>,
) -> Result<Json<Envelope<shennong_schema::Study>>, ApiError> {
    project_access(&state, &headers, &id, true).await?;
    value.project_id = id.clone();
    validate_study(&value, &id)?;
    let data = state
        .repository
        .upsert_study(&value)
        .await
        .map_err(database_error)?;
    audit(
        &state,
        &headers,
        "study.upsert",
        "study",
        &data.id,
        serde_json::json!({"project_id": id}),
    )
    .await?;
    Ok(Json(Envelope { data }))
}

async fn project_activity(
    state: &AppState,
    headers: &HeaderMap,
    project_id: &str,
    activity_id: &str,
    write: bool,
) -> Result<shennong_schema::Activity, ApiError> {
    project_access(state, headers, project_id, write).await?;
    state
        .repository
        .get_activity(activity_id)
        .await
        .map_err(database_error)?
        .filter(|activity| activity.project_id == project_id)
        .ok_or_else(not_found)
}

pub(super) async fn list_project_activity_io(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, activity_id)): Path<(String, String)>,
) -> Result<Json<Envelope<Vec<shennong_schema::ActivityIo>>>, ApiError> {
    project_activity(&state, &headers, &id, &activity_id, false).await?;
    let data = state
        .repository
        .list_activity_io(&activity_id)
        .await
        .map_err(database_error)?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn upsert_project_activity_io(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, activity_id)): Path<(String, String)>,
    Json(mut value): Json<ActivityIoUpsert>,
) -> Result<Json<Envelope<shennong_schema::ActivityIo>>, ApiError> {
    project_activity(&state, &headers, &id, &activity_id, true).await?;
    value.activity_id = activity_id.clone();
    validate_activity_io(&value)?;
    let entity = state
        .repository
        .get_research_entity(&value.entity_id)
        .await
        .map_err(database_error)?
        .ok_or_else(not_found)?;
    if entity
        .project_id
        .as_deref()
        .is_some_and(|entity_project_id| entity_project_id != id)
    {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "activity IO entity must be global or belong to the selected project".into(),
        ));
    }
    let data = state
        .repository
        .upsert_activity_io(&value)
        .await
        .map_err(database_error)?;
    audit(
        &state,
        &headers,
        "activity_io.upsert",
        "research_activity",
        &activity_id,
        serde_json::json!({"project_id": id, "entity_id": data.entity_id, "direction": data.direction}),
    )
    .await?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn list_project_activity_actors(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, activity_id)): Path<(String, String)>,
) -> Result<Json<Envelope<Vec<shennong_schema::ActivityActor>>>, ApiError> {
    project_activity(&state, &headers, &id, &activity_id, false).await?;
    let data = state
        .repository
        .list_activity_actors(&activity_id)
        .await
        .map_err(database_error)?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn upsert_project_activity_actor(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, activity_id)): Path<(String, String)>,
    Json(mut value): Json<ActivityActorUpsert>,
) -> Result<Json<Envelope<shennong_schema::ActivityActor>>, ApiError> {
    project_activity(&state, &headers, &id, &activity_id, true).await?;
    value.activity_id = activity_id.clone();
    validate_activity_actor(&value)?;
    let data = state
        .repository
        .upsert_activity_actor(&value)
        .await
        .map_err(database_error)?;
    audit(
        &state,
        &headers,
        "activity_actor.upsert",
        "research_activity",
        &activity_id,
        serde_json::json!({"project_id": id, "actor_type": data.actor_type, "actor_id": data.actor_id}),
    )
    .await?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn list_project_associations(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Envelope<Vec<shennong_schema::GraphAssociation>>>, ApiError> {
    project_access(&state, &headers, &id, false).await?;
    let data = state
        .repository
        .list_graph_associations(Some(&id), None, None, PROJECT_LIST_LIMIT)
        .await
        .map_err(database_error)?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn propose_project_association(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut value): Json<GraphAssociationUpsert>,
) -> Result<Json<Envelope<shennong_schema::GraphAssociation>>, ApiError> {
    let (actor, _) = project_access(&state, &headers, &id, true).await?;
    constrain_project_association(&mut value, &id, actor.user_id.as_deref());
    validate_graph_association(&value, &id)?;
    for entity_id in [&value.subject_id, &value.object_id] {
        let entity = state
            .repository
            .get_research_entity(entity_id)
            .await
            .map_err(database_error)?
            .ok_or_else(not_found)?;
        if entity
            .project_id
            .as_deref()
            .is_some_and(|project_id| project_id != id)
        {
            return Err(ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                "association entities must be global or belong to the selected project".into(),
            ));
        }
    }
    let data = state
        .repository
        .upsert_graph_association(&value)
        .await
        .map_err(database_error)?;
    audit(
        &state,
        &headers,
        "graph_association.propose",
        "graph_association",
        &data.id,
        serde_json::json!({"project_id": id, "status": "proposed", "knowledge_level": "hypothesis"}),
    )
    .await?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn list_project_evidence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Envelope<Vec<shennong_schema::EvidenceItem>>>, ApiError> {
    project_access(&state, &headers, &id, false).await?;
    let candidates = state
        .repository
        .list_evidence_items(Some(&id), PROJECT_LIST_LIMIT)
        .await
        .map_err(database_error)?;
    let mut data = Vec::new();
    for evidence in candidates {
        if evidence.project_id.as_deref() == Some(id.as_str())
            && evidence_visible(&state, &headers, &id, &evidence).await?
        {
            data.push(evidence);
        }
    }
    Ok(Json(Envelope { data }))
}

pub(super) async fn create_project_evidence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut value): Json<EvidenceItemCreate>,
) -> Result<Json<Envelope<shennong_schema::EvidenceItem>>, ApiError> {
    let (actor, _) = project_access(&state, &headers, &id, true).await?;
    value.project_id = Some(id.clone());
    value.created_by = actor.user_id.clone();
    validate_evidence(&value, &id)?;
    if let Some(source_id) = value.source_id.as_deref()
        && let Some(resource) = state
            .repository
            .get_resource(source_id)
            .await
            .map_err(database_error)?
        && !can_read(&state, &actor, &resource).await?
    {
        return Err(not_found());
    }
    let data = state
        .repository
        .create_evidence_item(&value)
        .await
        .map_err(database_error)?;
    audit(
        &state,
        &headers,
        "evidence.create",
        "evidence",
        &data.id,
        serde_json::json!({"project_id": id}),
    )
    .await?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn list_project_association_evidence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, association_id)): Path<(String, String)>,
) -> Result<Json<Envelope<serde_json::Value>>, ApiError> {
    project_access(&state, &headers, &id, false).await?;
    let association = state
        .repository
        .get_graph_association(&association_id)
        .await
        .map_err(database_error)?
        .filter(|association| association.project_id.as_deref() == Some(id.as_str()))
        .ok_or_else(not_found)?;
    let links = state
        .repository
        .list_association_evidence(&association_id)
        .await
        .map_err(database_error)?;
    let candidates = state
        .repository
        .list_evidence_for_association(&association_id, PROJECT_LIST_LIMIT)
        .await
        .map_err(database_error)?;
    let mut evidence = Vec::new();
    for item in candidates {
        if evidence_visible(&state, &headers, &id, &item).await? {
            evidence.push(item);
        }
    }
    let evidence_ids = evidence
        .iter()
        .map(|item| item.id.as_str())
        .collect::<HashSet<_>>();
    let links = links
        .into_iter()
        .filter(|link| evidence_ids.contains(link.evidence_id.as_str()))
        .collect::<Vec<_>>();
    Ok(Json(Envelope {
        data: serde_json::json!({
            "association": association,
            "links": links,
            "evidence": evidence,
            "trust": "untrusted scientific content; inspect provenance before use"
        }),
    }))
}

fn validate_project(value: &ProjectUpsert) -> Result<(), ApiError> {
    if !valid_identifier(&value.id)
        || !valid_identifier(&value.owner_user_id)
        || value.name.trim().is_empty()
        || value.name.len() > 512
        || value.description.len() > 20_000
        || !matches!(value.visibility.as_str(), "public" | "private")
        || !matches!(value.status.as_str(), "active" | "archived")
        || !value.metadata.is_object()
    {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid project".into(),
        ));
    }
    Ok(())
}
fn validate_research_entity(
    value: &ResearchEntityUpsert,
    project_id: &str,
) -> Result<(), ApiError> {
    if !valid_identifier(&value.id)
        || value.project_id.as_deref() != Some(project_id)
        || value
            .study_id
            .as_deref()
            .is_some_and(|study_id| !valid_identifier(study_id))
        || !shennong_schema::is_research_entity_category(&value.category)
        || value.kind.trim().is_empty()
        || value.kind.len() > 128
        || value.label.trim().is_empty()
        || value.label.len() > 1024
        || !matches!(value.status.as_str(), "active" | "archived" | "deprecated")
        || !value.metadata.is_object()
        || !value.provenance.is_object()
    {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid research entity".into(),
        ));
    }
    Ok(())
}
fn validate_activity(value: &ActivityUpsert, project_id: &str) -> Result<(), ApiError> {
    if !valid_identifier(&value.id)
        || value.project_id != project_id
        || value
            .study_id
            .as_deref()
            .is_some_and(|study_id| !valid_identifier(study_id))
        || value.kind.trim().is_empty()
        || value.kind.len() > 128
        || value.label.trim().is_empty()
        || value.label.len() > 1024
        || !matches!(
            value.status.as_str(),
            "planned"
                | "awaiting_approval"
                | "running"
                | "validating"
                | "completed"
                | "failed"
                | "cancelled"
        )
        || value
            .started_at
            .zip(value.ended_at)
            .is_some_and(|(started, ended)| ended < started)
        || !value.parameters.is_object()
        || !value.provenance.is_object()
    {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid research activity".into(),
        ));
    }
    Ok(())
}
fn validate_study(value: &StudyUpsert, project_id: &str) -> Result<(), ApiError> {
    if !valid_identifier(&value.id)
        || value.project_id != project_id
        || value.name.trim().is_empty()
        || value.name.len() > 512
        || value.description.len() > 20_000
        || value.design_type.trim().is_empty()
        || value.design_type.len() > 128
        || !matches!(
            value.status.as_str(),
            "planning" | "active" | "completed" | "archived"
        )
        || !value.metadata.is_object()
        || !value.provenance.is_object()
    {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid study".into(),
        ));
    }
    Ok(())
}
fn validate_activity_io(value: &ActivityIoUpsert) -> Result<(), ApiError> {
    if !valid_identifier(&value.activity_id)
        || !valid_identifier(&value.entity_id)
        || !matches!(value.direction.as_str(), "input" | "output")
        || value.role.trim().is_empty()
        || value.role.len() > 128
        || value.ordinal < 0
        || !value.metadata.is_object()
    {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid activity IO binding".into(),
        ));
    }
    Ok(())
}
fn validate_activity_actor(value: &ActivityActorUpsert) -> Result<(), ApiError> {
    if !valid_identifier(&value.activity_id)
        || !matches!(
            value.actor_type.as_str(),
            "user" | "agent" | "software" | "instrument" | "organization"
        )
        || value.actor_id.trim().is_empty()
        || value.actor_id.len() > 256
        || value.role.trim().is_empty()
        || value.role.len() > 128
        || !value.metadata.is_object()
    {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid activity actor".into(),
        ));
    }
    Ok(())
}
fn validate_graph_association(
    value: &GraphAssociationUpsert,
    project_id: &str,
) -> Result<(), ApiError> {
    if !valid_identifier(&value.id)
        || value.project_id.as_deref() != Some(project_id)
        || !valid_identifier(&value.subject_id)
        || !valid_identifier(&value.object_id)
        || value.subject_id == value.object_id
        || value.predicate.trim().is_empty()
        || value.predicate.len() > 256
        || !matches!(
            value.polarity.as_str(),
            "positive" | "negative" | "neutral" | "mixed"
        )
        || value.knowledge_level != "hypothesis"
        || value.status != "proposed"
        || value.scope != "project"
        || !value.qualifiers.is_object()
        || !value.provenance.is_object()
    {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid graph association proposal".into(),
        ));
    }
    Ok(())
}
fn validate_evidence(value: &EvidenceItemCreate, project_id: &str) -> Result<(), ApiError> {
    if !valid_identifier(&value.id)
        || value.project_id.as_deref() != Some(project_id)
        || value.evidence_type.trim().is_empty()
        || value.evidence_type.len() > 128
        || value
            .source_uri
            .as_ref()
            .is_some_and(|uri| uri.len() > 4096)
        || value.source_id.as_ref().is_some_and(|id| id.len() > 256)
        || !value.locator.is_object()
        || !value.statistics.is_object()
        || !value.provenance.is_object()
        || (value.source_uri.is_none()
            && value.source_id.is_none()
            && value
                .locator
                .as_object()
                .is_none_or(serde_json::Map::is_empty))
    {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid evidence item".into(),
        ));
    }
    Ok(())
}
fn validate_association_evidence(value: &AssociationEvidenceUpsert) -> Result<(), ApiError> {
    if !valid_identifier(&value.association_id)
        || !valid_identifier(&value.evidence_id)
        || !matches!(
            value.stance.as_str(),
            "supporting" | "contradicting" | "neutral"
        )
        || value
            .weight
            .is_some_and(|weight| !(0.0..=1.0).contains(&weight))
        || value.note.as_ref().is_some_and(|note| note.len() > 20_000)
    {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid association evidence link".into(),
        ));
    }
    Ok(())
}
fn validate_project_resource_binding(value: &ProjectResourceBindingUpsert) -> Result<(), ApiError> {
    if !valid_identifier(&value.project_id)
        || !valid_identifier(&value.resource_id)
        || value.role.trim().is_empty()
        || value.role.len() > 128
    {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid project Resource binding".into(),
        ));
    }
    Ok(())
}

pub(super) async fn link_project_association_evidence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, association_id, evidence_id)): Path<(String, String, String)>,
    Json(request): Json<AssociationEvidenceRequest>,
) -> Result<Json<Envelope<shennong_schema::AssociationEvidence>>, ApiError> {
    project_access(&state, &headers, &id, true).await?;
    state
        .repository
        .get_graph_association(&association_id)
        .await
        .map_err(database_error)?
        .filter(|association| association.project_id.as_deref() == Some(id.as_str()))
        .ok_or_else(not_found)?;
    let evidence = state
        .repository
        .get_evidence_item(&evidence_id)
        .await
        .map_err(database_error)?
        .ok_or_else(not_found)?;
    if !evidence_visible(&state, &headers, &id, &evidence).await? {
        return Err(not_found());
    }
    let value = AssociationEvidenceUpsert {
        association_id: association_id.clone(),
        evidence_id: evidence_id.clone(),
        stance: request.stance,
        weight: request.weight,
        note: request.note,
    };
    validate_association_evidence(&value)?;
    let data = state
        .repository
        .link_association_evidence(&value)
        .await
        .map_err(database_error)?;
    audit(
        &state,
        &headers,
        "association_evidence.link",
        "graph_association",
        &association_id,
        serde_json::json!({"project_id": id, "evidence_id": evidence_id, "stance": data.stance}),
    )
    .await?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn list_project_resources(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Envelope<serde_json::Value>>, ApiError> {
    project_access(&state, &headers, &id, false).await?;
    let actor = principal(&headers, &state);
    let candidates = state
        .repository
        .list_project_resources(&id, PROJECT_LIST_LIMIT)
        .await
        .map_err(database_error)?;
    let mut resources = Vec::new();
    for resource in candidates {
        if can_read(&state, &actor, &resource).await? {
            resources.push(resource);
        }
    }
    let visible_ids = resources
        .iter()
        .map(|resource| resource.id.as_str())
        .collect::<HashSet<_>>();
    let bindings = state
        .repository
        .list_project_resource_bindings(&id, PROJECT_LIST_LIMIT)
        .await
        .map_err(database_error)?
        .into_iter()
        .filter(|binding| visible_ids.contains(binding.resource_id.as_str()))
        .collect::<Vec<_>>();
    Ok(Json(Envelope {
        data: serde_json::json!({"resources": resources, "bindings": bindings}),
    }))
}

pub(super) async fn bind_project_resource(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, resource_id)): Path<(String, String)>,
    payload: Option<Json<ProjectResourceBindingUpsert>>,
) -> Result<Json<Envelope<shennong_schema::ProjectResourceBinding>>, ApiError> {
    let (actor, _) = project_access(&state, &headers, &id, true).await?;
    let resource = state
        .repository
        .get_resource(&resource_id)
        .await
        .map_err(database_error)?
        .ok_or_else(not_found)?;
    if !can_read(&state, &actor, &resource).await? {
        return Err(not_found());
    }
    let mut value = payload
        .map(|Json(value)| value)
        .unwrap_or(ProjectResourceBindingUpsert {
            project_id: id.clone(),
            resource_id: resource_id.clone(),
            role: "data".into(),
            added_by: actor.user_id.clone(),
        });
    value.project_id = id.clone();
    value.resource_id = resource_id.clone();
    value.added_by = actor.user_id.clone();
    if value.role.trim().is_empty() {
        value.role = "data".into();
    }
    validate_project_resource_binding(&value)?;
    let data = state
        .repository
        .bind_project_resource(&value)
        .await
        .map_err(database_error)?;
    audit(
        &state,
        &headers,
        "project_resource.bind",
        "project",
        &id,
        serde_json::json!({"resource_id": resource_id, "role": data.role}),
    )
    .await?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn unbind_project_resource(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, resource_id)): Path<(String, String)>,
    Query(query): Query<ProjectResourceRoleQuery>,
) -> Result<StatusCode, ApiError> {
    project_access(&state, &headers, &id, true).await?;
    let role = query.role.as_deref().unwrap_or("data");
    if role.is_empty() || role.len() > 128 {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid project Resource role".into(),
        ));
    }
    if !state
        .repository
        .unbind_project_resource(&id, &resource_id, role)
        .await
        .map_err(database_error)?
    {
        return Err(not_found());
    }
    audit(
        &state,
        &headers,
        "project_resource.unbind",
        "project",
        &id,
        serde_json::json!({"resource_id": resource_id, "role": role}),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn search_graph(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<GraphSearchRequest>,
) -> Result<Json<Envelope<Vec<shennong_schema::ResearchEntity>>>, ApiError> {
    let query = request.q.trim();
    if query.is_empty() || query.len() > 256 {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "graph search query must be between 1 and 256 characters".into(),
        ));
    }
    if let Some(project_id) = request.project_id.as_deref() {
        project_access(&state, &headers, project_id, false).await?;
    }
    let limit = request.limit.unwrap_or(50);
    if !(1..=100).contains(&limit) {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "graph search limit must be between 1 and 100".into(),
        ));
    }
    let data = state
        .repository
        .search_research_entities(request.project_id.as_deref(), query, limit as i64)
        .await
        .map_err(database_error)?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn get_graph_node(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Envelope<shennong_schema::ResearchEntity>>, ApiError> {
    let data = graph_entity_visible(&state, &headers, &id).await?;
    Ok(Json(Envelope { data }))
}

pub(super) async fn get_subgraph(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(request): Query<GraphSubgraphQuery>,
) -> Result<Json<Envelope<shennong_schema::ResearchSubgraph>>, ApiError> {
    if !valid_identifier(&request.root) {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid graph root".into(),
        ));
    }
    if request
        .project_id
        .as_deref()
        .is_some_and(|project_id| !valid_identifier(project_id))
    {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid project id".into(),
        ));
    }
    let root = graph_entity_visible(&state, &headers, &request.root).await?;
    if request
        .project_id
        .as_deref()
        .is_some_and(|project_id| !belongs_to_project(root.project_id.as_deref(), project_id))
    {
        return Err(not_found());
    }
    let (depth, limit) = graph_bounds(request.depth, request.limit)?;
    let data = state
        .repository
        .research_subgraph(&request.root, depth, limit as i64)
        .await
        .map_err(database_error)?;
    if request
        .project_id
        .as_deref()
        .is_some_and(|project_id| !subgraph_within_project(&data, project_id))
    {
        return Err(ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "graph result unavailable".into(),
        ));
    }
    Ok(Json(Envelope { data }))
}

pub(super) async fn project_context_pack(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Envelope<shennong_schema::ProjectContextPack>>, ApiError> {
    let (actor, _) = project_access(&state, &headers, &id, false).await?;
    let mut data = state
        .repository
        .project_context_pack(&id, PROJECT_CONTEXT_LIMIT)
        .await
        .map_err(database_error)?;
    let mut visible_resources = Vec::new();
    for resource in std::mem::take(&mut data.resources) {
        if can_read(&state, &actor, &resource).await? {
            visible_resources.push(resource);
        }
    }
    let visible_resource_ids = visible_resources
        .iter()
        .map(|resource| resource.id.clone())
        .collect::<HashSet<_>>();
    data.resources = visible_resources;
    data.project_resources
        .retain(|binding| visible_resource_ids.contains(&binding.resource_id));
    data.resource_revisions
        .retain(|revision| visible_resource_ids.contains(&revision.resource_id));
    data.resource_graph_bindings
        .retain(|binding| visible_resource_ids.contains(&binding.resource_id));

    let mut visible_evidence = Vec::new();
    for evidence in std::mem::take(&mut data.evidence) {
        if evidence_visible(&state, &headers, &id, &evidence).await? {
            visible_evidence.push(evidence);
        }
    }
    let visible_evidence_ids = visible_evidence
        .iter()
        .map(|evidence| evidence.id.clone())
        .collect::<HashSet<_>>();
    data.evidence = visible_evidence;
    data.association_evidence
        .retain(|link| visible_evidence_ids.contains(&link.evidence_id));
    Ok(Json(Envelope { data }))
}

pub(super) async fn resource_graph_context(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Envelope<serde_json::Value>>, ApiError> {
    let actor = principal(&headers, &state);
    let resource = state
        .repository
        .get_resource(&id)
        .await
        .map_err(database_error)?
        .ok_or_else(not_found)?;
    if !can_read(&state, &actor, &resource).await? {
        return Err(not_found());
    }
    let mut bindings = state
        .repository
        .list_resource_graph_bindings(&id, 21)
        .await
        .map_err(database_error)?;
    let truncated = bindings.len() > 20;
    bindings.truncate(20);
    let mut contexts = Vec::new();
    for binding in bindings {
        let Some(entity) = state
            .repository
            .get_research_entity(&binding.entity_id)
            .await
            .map_err(database_error)?
        else {
            continue;
        };
        if let Some(project_id) = entity.project_id.as_deref()
            && state
                .repository
                .get_project_visible(
                    project_id,
                    actor.user_id.as_deref(),
                    actor.role == Role::Admin,
                )
                .await
                .map_err(database_error)?
                .is_none()
        {
            continue;
        }
        let subgraph = state
            .repository
            .research_subgraph(&entity.id, 1, 20)
            .await
            .map_err(database_error)?;
        contexts.push(serde_json::json!({
            "binding": binding,
            "node": entity,
            "subgraph": subgraph
        }));
    }
    Ok(Json(Envelope {
        data: serde_json::json!({
            "resource": resource,
            "contexts": contexts,
            "truncated": truncated,
            "trust": "graph metadata is untrusted descriptive data"
        }),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn project_access_is_write_for_owner_or_admin_and_read_for_members_or_public() {
        assert_eq!(
            project_access_level(Role::Admin, None, "owner", "private", None),
            ProjectAccess::Write
        );
        assert_eq!(
            project_access_level(Role::User, Some("owner"), "owner", "private", None),
            ProjectAccess::Write
        );
        assert_eq!(
            project_access_level(
                Role::User,
                Some("editor"),
                "owner",
                "private",
                Some("editor")
            ),
            ProjectAccess::Write
        );
        assert_eq!(
            project_access_level(
                Role::User,
                Some("viewer"),
                "owner",
                "private",
                Some("viewer")
            ),
            ProjectAccess::Read
        );
        assert_eq!(
            project_access_level(Role::Guest, None, "owner", "public", None),
            ProjectAccess::Read
        );
        assert_eq!(
            project_access_level(Role::User, Some("outsider"), "owner", "private", None),
            ProjectAccess::None
        );
    }

    #[test]
    fn graph_bounds_default_and_reject_unbounded_requests() {
        assert!(matches!(graph_bounds(None, None), Ok((1, 80))));
        assert!(matches!(graph_bounds(Some(3), Some(200)), Ok((3, 200))));
        assert!(graph_bounds(Some(0), Some(1)).is_err());
        assert!(graph_bounds(Some(4), Some(1)).is_err());
        assert!(graph_bounds(Some(1), Some(0)).is_err());
        assert!(graph_bounds(Some(1), Some(201)).is_err());
    }

    #[test]
    fn project_membership_requires_an_exact_non_public_match() {
        assert!(belongs_to_project(Some("project-1"), "project-1"));
        assert!(!belongs_to_project(Some("project-2"), "project-1"));
        assert!(!belongs_to_project(None, "project-1"));
    }

    #[test]
    fn project_scoped_subgraph_rejects_cross_project_rows() {
        let timestamp = chrono::Utc::now();
        let entity = shennong_schema::ResearchEntity {
            id: "entity-1".into(),
            project_id: Some("project-1".into()),
            study_id: None,
            category: "sample".into(),
            kind: "sample".into(),
            label: "Entity".into(),
            ontology_id: None,
            canonical_key: None,
            status: "active".into(),
            metadata: json!({}),
            provenance: json!({}),
            created_at: timestamp,
            updated_at: timestamp,
        };
        let association = shennong_schema::GraphAssociation {
            id: "association-1".into(),
            project_id: Some("project-1".into()),
            subject_id: "entity-1".into(),
            predicate: "derived_from".into(),
            object_id: "entity-2".into(),
            qualifiers: json!({}),
            polarity: "neutral".into(),
            knowledge_level: "observation".into(),
            status: "proposed".into(),
            scope: "project".into(),
            provenance: json!({}),
            created_by: None,
            created_at: timestamp,
            updated_at: timestamp,
        };
        let mut subgraph = shennong_schema::ResearchSubgraph {
            root_entity_id: "entity-1".into(),
            depth: 1,
            truncated: false,
            entities: vec![entity],
            associations: vec![association],
        };

        assert!(subgraph_within_project(&subgraph, "project-1"));
        subgraph.entities[0].project_id = Some("project-2".into());
        assert!(!subgraph_within_project(&subgraph, "project-1"));
        subgraph.entities[0].project_id = Some("project-1".into());
        subgraph.associations[0].project_id = None;
        assert!(!subgraph_within_project(&subgraph, "project-1"));
    }

    #[test]
    fn agent_association_cannot_self_validate() {
        let mut value = GraphAssociationUpsert {
            id: "association-1".into(),
            project_id: None,
            subject_id: "subject-1".into(),
            predicate: "associated_with".into(),
            object_id: "object-1".into(),
            qualifiers: json!({}),
            polarity: "positive".into(),
            knowledge_level: "assertion".into(),
            status: "validated".into(),
            scope: "public".into(),
            provenance: json!({"agent":"test"}),
            created_by: None,
        };
        constrain_project_association(&mut value, "project-1", Some("agent-user"));
        assert_eq!(value.project_id.as_deref(), Some("project-1"));
        assert_eq!(value.scope, "project");
        assert_eq!(value.knowledge_level, "hypothesis");
        assert_eq!(value.status, "proposed");
        assert_eq!(value.created_by.as_deref(), Some("agent-user"));
    }

    #[test]
    fn external_project_sync_requires_service_identity_and_matching_id() {
        let service = Principal {
            role: Role::Admin,
            user_id: None,
            scopes: Vec::new(),
            token_hash: None,
        };
        let user_admin = Principal {
            role: Role::Admin,
            user_id: Some("user-admin".into()),
            scopes: Vec::new(),
            token_hash: None,
        };
        assert!(require_service_principal(&service).is_ok());
        assert_eq!(
            require_service_principal(&user_admin).unwrap_err().0,
            StatusCode::UNAUTHORIZED
        );

        let project = ProjectUpsert {
            id: "project-1".into(),
            name: "Project".into(),
            description: String::new(),
            owner_user_id: "os-user-1".into(),
            visibility: "private".into(),
            status: "active".into(),
            metadata: json!({"authority":"shennong-os"}),
        };
        assert!(validate_external_project_sync("project-1", &project).is_ok());
        assert_eq!(
            validate_external_project_sync("project-2", &project)
                .unwrap_err()
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[test]
    fn openapi_lists_research_graph_vertical_routes() {
        let specification: serde_json::Value =
            serde_json::from_str(include_str!("../../../openapi/shennongdb.json")).unwrap();
        let paths = specification["paths"].as_object().unwrap();
        for (path, methods) in [
            ("/api/v1/research-projects", &["get"][..]),
            (
                "/api/v1/research-projects/{project_id}",
                &["get", "put"][..],
            ),
            (
                "/api/v1/research-projects/{project_id}/context-pack",
                &["get"][..],
            ),
            (
                "/api/v1/research-projects/{project_id}/studies",
                &["get", "post"][..],
            ),
            (
                "/api/v1/research-projects/{project_id}/entities",
                &["get", "post"][..],
            ),
            (
                "/api/v1/research-projects/{project_id}/activities",
                &["get", "post"][..],
            ),
            (
                "/api/v1/research-projects/{project_id}/activities/{activity_id}/io",
                &["get", "post"][..],
            ),
            (
                "/api/v1/research-projects/{project_id}/activities/{activity_id}/actors",
                &["get", "post"][..],
            ),
            (
                "/api/v1/research-projects/{project_id}/associations",
                &["get", "post"][..],
            ),
            (
                "/api/v1/research-projects/{project_id}/evidence",
                &["get", "post"][..],
            ),
            (
                "/api/v1/research-projects/{project_id}/associations/{association_id}/evidence",
                &["get"][..],
            ),
            (
                "/api/v1/research-projects/{project_id}/associations/{association_id}/evidence/{evidence_id}",
                &["put"][..],
            ),
            (
                "/api/v1/research-projects/{project_id}/resources",
                &["get"][..],
            ),
            (
                "/api/v1/research-projects/{project_id}/resources/{resource_id}",
                &["put", "delete"][..],
            ),
            ("/api/v1/graph/search", &["post"][..]),
            ("/api/v1/graph/nodes/{id}", &["get"][..]),
            ("/api/v1/graph/subgraph", &["get"][..]),
            ("/api/v1/resources/{id}/graph-context", &["get"][..]),
        ] {
            let route = paths
                .get(path)
                .unwrap_or_else(|| panic!("missing OpenAPI route {path}"));
            for method in methods {
                assert!(route.get(*method).is_some(), "missing {method} {path}");
            }
        }

        let subgraph_parameters = paths["/api/v1/graph/subgraph"]["get"]["parameters"]
            .as_array()
            .unwrap();
        let parameter = |name: &str| {
            subgraph_parameters
                .iter()
                .find(|parameter| parameter["name"] == name)
                .unwrap_or_else(|| panic!("missing graph subgraph parameter {name}"))
        };
        assert_eq!(parameter("root")["required"], true);
        assert_eq!(parameter("depth")["schema"]["maximum"], 3);
        assert_eq!(parameter("limit")["schema"]["maximum"], 200);
        assert_eq!(parameter("project_id")["required"], false);
    }
}
