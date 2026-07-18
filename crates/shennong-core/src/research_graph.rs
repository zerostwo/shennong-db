use super::ResourceRepository;
use shennong_schema::{
    Activity, ActivityActor, ActivityActorUpsert, ActivityIo, ActivityIoUpsert, ActivityUpsert,
    AssociationEvidence, AssociationEvidenceUpsert, EvidenceItem, EvidenceItemCreate,
    GraphAssociation, GraphAssociationUpsert, Project, ProjectContextPack, ProjectMember,
    ProjectMemberUpsert, ProjectResourceBinding, ProjectResourceBindingUpsert, ProjectUpsert,
    ResearchEntity, ResearchEntityUpsert, ResearchSubgraph, Resource, ResourceGraphBinding,
    ResourceGraphBindingUpsert, ResourceRevision, ResourceRevisionCreate, Study, StudyUpsert,
    is_research_entity_category,
};

pub const MAX_RESEARCH_GRAPH_DEPTH: u8 = 3;
pub const MAX_RESEARCH_GRAPH_LIMIT: i64 = 1_000;

fn checked_limit(limit: i64) -> Result<i64, sqlx::Error> {
    if !(1..=MAX_RESEARCH_GRAPH_LIMIT).contains(&limit) {
        return Err(sqlx::Error::Protocol(format!(
            "research graph limit must be between 1 and {MAX_RESEARCH_GRAPH_LIMIT}"
        )));
    }
    Ok(limit)
}

fn checked_depth(depth: u8) -> Result<i32, sqlx::Error> {
    if !(1..=MAX_RESEARCH_GRAPH_DEPTH).contains(&depth) {
        return Err(sqlx::Error::Protocol(format!(
            "research graph depth must be between 1 and {MAX_RESEARCH_GRAPH_DEPTH}"
        )));
    }
    Ok(i32::from(depth))
}

fn truncate_rows<T>(rows: &mut Vec<T>, limit: i64) -> bool {
    if rows.len() > limit as usize {
        rows.truncate(limit as usize);
        true
    } else {
        false
    }
}

impl ResourceRepository {
    pub async fn create_project(&self, value: &ProjectUpsert) -> Result<Project, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let project = sqlx::query_as(
            "INSERT INTO projects (id,name,description,owner_user_id,visibility,status,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,description,owner_user_id,visibility,status,metadata,created_at,updated_at",
        )
        .bind(&value.id)
        .bind(&value.name)
        .bind(&value.description)
        .bind(&value.owner_user_id)
        .bind(&value.visibility)
        .bind(&value.status)
        .bind(&value.metadata)
        .fetch_one(&mut *transaction)
        .await?;
        sqlx::query("INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,'owner')")
            .bind(&value.id)
            .bind(&value.owner_user_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(project)
    }

    /// Mirrors the Shennong OS Project boundary into the headless data plane.
    ///
    /// Shennong OS remains authoritative for identity and Project RBAC. The
    /// owner is therefore stored as an opaque OS identifier, and this method
    /// deliberately does not create DB-local users or `project_members` rows.
    pub async fn sync_external_project(
        &self,
        value: &ProjectUpsert,
    ) -> Result<Project, sqlx::Error> {
        sqlx::query_as(
            "INSERT INTO projects (id,name,description,owner_user_id,visibility,status,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,owner_user_id=EXCLUDED.owner_user_id,visibility=EXCLUDED.visibility,status=EXCLUDED.status,metadata=EXCLUDED.metadata,updated_at=CASE WHEN (projects.name,projects.description,projects.owner_user_id,projects.visibility,projects.status,projects.metadata) IS DISTINCT FROM (EXCLUDED.name,EXCLUDED.description,EXCLUDED.owner_user_id,EXCLUDED.visibility,EXCLUDED.status,EXCLUDED.metadata) THEN NOW() ELSE projects.updated_at END RETURNING id,name,description,owner_user_id,visibility,status,metadata,created_at,updated_at",
        )
        .bind(&value.id)
        .bind(&value.name)
        .bind(&value.description)
        .bind(&value.owner_user_id)
        .bind(&value.visibility)
        .bind(&value.status)
        .bind(&value.metadata)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn update_project(&self, value: &ProjectUpsert) -> Result<Project, sqlx::Error> {
        sqlx::query_as(
            "UPDATE projects SET name=$2,description=$3,visibility=$4,status=$5,metadata=$6,updated_at=NOW() WHERE id=$1 AND owner_user_id=$7 RETURNING id,name,description,owner_user_id,visibility,status,metadata,created_at,updated_at",
        )
        .bind(&value.id)
        .bind(&value.name)
        .bind(&value.description)
        .bind(&value.visibility)
        .bind(&value.status)
        .bind(&value.metadata)
        .bind(&value.owner_user_id)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn get_project(&self, id: &str) -> Result<Option<Project>, sqlx::Error> {
        sqlx::query_as(
            "SELECT id,name,description,owner_user_id,visibility,status,metadata,created_at,updated_at FROM projects WHERE id=$1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn list_projects(
        &self,
        user_id: Option<&str>,
        is_admin: bool,
    ) -> Result<Vec<Project>, sqlx::Error> {
        sqlx::query_as(
            "SELECT p.id,p.name,p.description,p.owner_user_id,p.visibility,p.status,p.metadata,p.created_at,p.updated_at FROM projects p WHERE p.visibility='public' OR $2 OR ($1::text IS NOT NULL AND (p.owner_user_id=$1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$1))) ORDER BY p.updated_at DESC,p.id",
        )
        .bind(user_id)
        .bind(is_admin)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_project_visible(
        &self,
        id: &str,
        user_id: Option<&str>,
        is_admin: bool,
    ) -> Result<Option<Project>, sqlx::Error> {
        sqlx::query_as(
            "SELECT p.id,p.name,p.description,p.owner_user_id,p.visibility,p.status,p.metadata,p.created_at,p.updated_at FROM projects p WHERE p.id=$1 AND (p.visibility='public' OR $3 OR ($2::text IS NOT NULL AND (p.owner_user_id=$2 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$2))))",
        )
        .bind(id)
        .bind(user_id)
        .bind(is_admin)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn can_write_project(
        &self,
        id: &str,
        user_id: Option<&str>,
        is_admin: bool,
    ) -> Result<bool, sqlx::Error> {
        if is_admin {
            return Ok(true);
        }
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM projects p WHERE p.id=$1 AND $2::text IS NOT NULL AND (p.owner_user_id=$2 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$2 AND m.role IN ('owner','editor'))))",
        )
        .bind(id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn upsert_project_member(
        &self,
        value: &ProjectMemberUpsert,
    ) -> Result<ProjectMember, sqlx::Error> {
        sqlx::query_as(
            "INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET role=EXCLUDED.role WHERE project_members.role<>'owner' RETURNING project_id,user_id,role,created_at",
        )
        .bind(&value.project_id)
        .bind(&value.user_id)
        .bind(&value.role)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn list_project_members(
        &self,
        project_id: &str,
    ) -> Result<Vec<ProjectMember>, sqlx::Error> {
        sqlx::query_as(
            "SELECT project_id,user_id,role,created_at FROM project_members WHERE project_id=$1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,user_id",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn remove_project_member(
        &self,
        project_id: &str,
        user_id: &str,
    ) -> Result<bool, sqlx::Error> {
        Ok(sqlx::query(
            "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2 AND role<>'owner'",
        )
        .bind(project_id)
        .bind(user_id)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    pub async fn upsert_study(&self, value: &StudyUpsert) -> Result<Study, sqlx::Error> {
        sqlx::query_as(
            "INSERT INTO studies(id,project_id,name,description,design_type,status,metadata,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,design_type=EXCLUDED.design_type,status=EXCLUDED.status,metadata=EXCLUDED.metadata,provenance=EXCLUDED.provenance,updated_at=NOW() WHERE studies.project_id=EXCLUDED.project_id RETURNING id,project_id,name,description,design_type,status,metadata,provenance,created_at,updated_at",
        )
        .bind(&value.id)
        .bind(&value.project_id)
        .bind(&value.name)
        .bind(&value.description)
        .bind(&value.design_type)
        .bind(&value.status)
        .bind(&value.metadata)
        .bind(&value.provenance)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn get_study(&self, id: &str) -> Result<Option<Study>, sqlx::Error> {
        sqlx::query_as("SELECT id,project_id,name,description,design_type,status,metadata,provenance,created_at,updated_at FROM studies WHERE id=$1")
            .bind(id).fetch_optional(&self.pool).await
    }

    pub async fn list_studies(
        &self,
        project_id: &str,
        limit: i64,
    ) -> Result<Vec<Study>, sqlx::Error> {
        let limit = checked_limit(limit)?;
        sqlx::query_as("SELECT id,project_id,name,description,design_type,status,metadata,provenance,created_at,updated_at FROM studies WHERE project_id=$1 ORDER BY updated_at DESC,id LIMIT $2")
            .bind(project_id).bind(limit).fetch_all(&self.pool).await
    }

    pub async fn upsert_research_entity(
        &self,
        value: &ResearchEntityUpsert,
    ) -> Result<ResearchEntity, sqlx::Error> {
        if !is_research_entity_category(&value.category) {
            return Err(sqlx::Error::Protocol(
                "invalid research entity category".into(),
            ));
        }
        sqlx::query_as(
            "INSERT INTO research_entities(id,project_id,study_id,category,kind,label,ontology_id,canonical_key,status,metadata,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET category=EXCLUDED.category,kind=EXCLUDED.kind,label=EXCLUDED.label,ontology_id=EXCLUDED.ontology_id,canonical_key=EXCLUDED.canonical_key,status=EXCLUDED.status,metadata=EXCLUDED.metadata,provenance=EXCLUDED.provenance,updated_at=NOW() WHERE research_entities.project_id IS NOT DISTINCT FROM EXCLUDED.project_id AND research_entities.study_id IS NOT DISTINCT FROM EXCLUDED.study_id RETURNING id,project_id,study_id,category,kind,label,ontology_id,canonical_key,status,metadata,provenance,created_at,updated_at",
        )
        .bind(&value.id)
        .bind(&value.project_id)
        .bind(&value.study_id)
        .bind(&value.category)
        .bind(&value.kind)
        .bind(&value.label)
        .bind(&value.ontology_id)
        .bind(&value.canonical_key)
        .bind(&value.status)
        .bind(&value.metadata)
        .bind(&value.provenance)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn get_research_entity(
        &self,
        id: &str,
    ) -> Result<Option<ResearchEntity>, sqlx::Error> {
        sqlx::query_as("SELECT id,project_id,study_id,category,kind,label,ontology_id,canonical_key,status,metadata,provenance,created_at,updated_at FROM research_entities WHERE id=$1")
            .bind(id).fetch_optional(&self.pool).await
    }

    pub async fn list_research_entities(
        &self,
        project_id: &str,
        study_id: Option<&str>,
        category: Option<&str>,
        limit: i64,
    ) -> Result<Vec<ResearchEntity>, sqlx::Error> {
        let limit = checked_limit(limit)?;
        sqlx::query_as("SELECT id,project_id,study_id,category,kind,label,ontology_id,canonical_key,status,metadata,provenance,created_at,updated_at FROM research_entities WHERE project_id=$1 AND ($2::text IS NULL OR study_id=$2) AND ($3::text IS NULL OR category=$3) ORDER BY updated_at DESC,id LIMIT $4")
            .bind(project_id).bind(study_id).bind(category).bind(limit).fetch_all(&self.pool).await
    }

    pub async fn search_research_entities(
        &self,
        project_id: Option<&str>,
        search: &str,
        limit: i64,
    ) -> Result<Vec<ResearchEntity>, sqlx::Error> {
        let limit = checked_limit(limit)?;
        sqlx::query_as("SELECT id,project_id,study_id,category,kind,label,ontology_id,canonical_key,status,metadata,provenance,created_at,updated_at FROM research_entities WHERE (($1::text IS NULL AND project_id IS NULL) OR ($1::text IS NOT NULL AND (project_id=$1 OR project_id IS NULL))) AND ($2='' OR to_tsvector('simple',label||' '||kind||' '||category||' '||COALESCE(ontology_id,'')||' '||COALESCE(canonical_key,'')) @@ websearch_to_tsquery('simple',$2)) ORDER BY CASE WHEN canonical_key=$2 OR ontology_id=$2 THEN 0 ELSE 1 END,label,id LIMIT $3")
            .bind(project_id).bind(search).bind(limit).fetch_all(&self.pool).await
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::{MAX_RESEARCH_GRAPH_DEPTH, MAX_RESEARCH_GRAPH_LIMIT, ResourceRepository};
    use serde_json::json;
    use shennong_schema::{
        ActivityActorUpsert, ActivityIoUpsert, ActivityUpsert, ArtifactUpsert,
        AssociationEvidenceUpsert, EvidenceItemCreate, GraphAssociationUpsert,
        ProjectResourceBindingUpsert, ProjectUpsert, ResearchEntityUpsert,
        ResourceGraphBindingUpsert, ResourcePermissions, ResourceRevisionCreate, ResourceUpsert,
        StudyUpsert, UserUpsert,
    };
    use uuid::Uuid;

    const MIGRATION: &str = include_str!("../migrations/0012_research_graph.sql");
    const OS_PROJECT_BOUNDARY_MIGRATION: &str =
        include_str!("../migrations/0016_os_project_boundary.sql");
    const V1_PROVENANCE_INTEGRITY_MIGRATION: &str =
        include_str!("../migrations/0018_v1_provenance_integrity.sql");

    #[test]
    fn migration_contains_graph_integrity_and_access_indexes() {
        for required in [
            "CREATE TABLE projects",
            "CREATE TABLE research_entities",
            "CREATE TABLE resource_revisions",
            "resource_revisions_immutable",
            "graph_associations_scope_guard",
            "association_evidence_scope_guard",
            "ix_graph_associations_scope_status_spo",
            "ix_activity_io_entity",
            "ix_resource_graph_bindings_entity",
        ] {
            assert!(MIGRATION.contains(required), "missing {required}");
        }
        assert!(!MIGRATION.contains("metadata::text"));
    }

    #[test]
    fn os_project_boundary_migration_removes_db_user_foreign_key() {
        assert!(
            OS_PROJECT_BOUNDARY_MIGRATION
                .contains("DROP CONSTRAINT IF EXISTS projects_owner_user_id_fkey")
        );
        assert!(OS_PROJECT_BOUNDARY_MIGRATION.contains("Opaque Shennong OS user identifier"));
        assert!(!OS_PROJECT_BOUNDARY_MIGRATION.contains("CREATE TABLE users"));
    }

    #[test]
    fn v1_migration_enforces_linear_revisions_and_artifact_lineage() {
        for required in [
            "resource_revisions_linear_history",
            "the first resource revision cannot have a parent",
            "the preceding resource revision is missing",
            "resource revision parent must be the preceding revision",
            "artifacts_provenance_integrity",
            "artifact lineage reference does not exist",
            "artifact lineage parents must be immutable",
            "FOR KEY SHARE",
            "immutable artifacts cannot be changed",
            "CREATE INDEX ix_artifacts_derived_from_gin",
            "ON artifacts USING GIN (derived_from)",
            "artifacts_delete_integrity",
            "immutable artifacts cannot be deleted",
            "artifacts referenced by lineage cannot be deleted",
        ] {
            assert!(
                V1_PROVENANCE_INTEGRITY_MIGRATION.contains(required),
                "missing {required}"
            );
        }
    }

    #[test]
    fn graph_bounds_are_deliberately_small() {
        assert_eq!(MAX_RESEARCH_GRAPH_DEPTH, 3);
        assert_eq!(MAX_RESEARCH_GRAPH_LIMIT, 1_000);
    }

    #[tokio::test]
    #[ignore = "requires PostgreSQL in SHENNONG_TEST_DATABASE_URL; creates an isolated database"]
    async fn postgres_migration_crud_constraints_and_traversal() {
        let admin_url = std::env::var("SHENNONG_TEST_DATABASE_URL")
            .expect("SHENNONG_TEST_DATABASE_URL must point to an administrative database");
        let suffix = Uuid::new_v4().simple().to_string();
        let database_name = format!("shennong_graph_{suffix}");
        let admin_pool = sqlx::PgPool::connect(&admin_url).await.unwrap();
        sqlx::query(&format!("CREATE DATABASE {database_name}"))
            .execute(&admin_pool)
            .await
            .unwrap();
        let (base, query) = admin_url
            .split_once('?')
            .map_or((admin_url.as_str(), None), |(base, query)| {
                (base, Some(query))
            });
        let prefix = base.rsplit_once('/').unwrap().0;
        let database_url = match query {
            Some(query) => format!("{prefix}/{database_name}?{query}"),
            None => format!("{prefix}/{database_name}"),
        };
        let repository = ResourceRepository::connect(&database_url).await.unwrap();
        repository.migrate().await.unwrap();

        let external_project_id = format!("external-project-{suffix}");
        let external_owner_id = format!("os-user-{suffix}");
        let external_project = ProjectUpsert {
            id: external_project_id.clone(),
            name: "OS Project".into(),
            description: "headless shadow".into(),
            owner_user_id: external_owner_id.clone(),
            visibility: "private".into(),
            status: "active".into(),
            metadata: json!({"authority":"shennong-os"}),
        };
        let first_sync = repository
            .sync_external_project(&external_project)
            .await
            .unwrap();
        let second_sync = repository
            .sync_external_project(&ProjectUpsert {
                name: "Renamed OS Project".into(),
                visibility: "public".into(),
                ..external_project
            })
            .await
            .unwrap();
        assert_eq!(first_sync.id, second_sync.id);
        assert_eq!(second_sync.name, "Renamed OS Project");
        assert_eq!(second_sync.owner_user_id, external_owner_id);
        assert_eq!(second_sync.visibility, "public");
        let external_members: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM project_members WHERE project_id=$1")
                .bind(&external_project_id)
                .fetch_one(&repository.pool)
                .await
                .unwrap();
        assert_eq!(external_members, 0);

        let user_id = format!("user-{suffix}");
        repository
            .upsert_user(&UserUpsert {
                id: user_id.clone(),
                display_name: "Researcher".into(),
                email: Some(format!("{suffix}@example.test")),
                role: "user".into(),
                status: "active".into(),
                password: None,
                password_hash: None,
                totp_secret: None,
            })
            .await
            .unwrap();
        let project_id = format!("project-{suffix}");
        repository
            .create_project(&ProjectUpsert {
                id: project_id.clone(),
                name: "Graph project".into(),
                description: "integration test".into(),
                owner_user_id: user_id.clone(),
                visibility: "private".into(),
                status: "active".into(),
                metadata: json!({"purpose":"test"}),
            })
            .await
            .unwrap();
        assert!(
            repository
                .can_write_project(&project_id, Some(&user_id), false)
                .await
                .unwrap()
        );
        let study_id = format!("study-{suffix}");
        repository
            .upsert_study(&StudyUpsert {
                id: study_id.clone(),
                project_id: project_id.clone(),
                name: "Study".into(),
                description: String::new(),
                design_type: "case_control".into(),
                status: "active".into(),
                metadata: json!({}),
                provenance: json!({}),
            })
            .await
            .unwrap();
        let subject_id = format!("subject-{suffix}");
        let sample_id = format!("sample-{suffix}");
        let result_id = format!("result-{suffix}");
        for (id, category, kind, label) in [
            (&subject_id, "subject", "human_subject", "Subject"),
            (&sample_id, "sample", "blood", "Sample"),
            (&result_id, "observation", "measurement", "Observation"),
        ] {
            repository
                .upsert_research_entity(&ResearchEntityUpsert {
                    id: id.clone(),
                    project_id: Some(project_id.clone()),
                    study_id: Some(study_id.clone()),
                    category: category.into(),
                    kind: kind.into(),
                    label: label.into(),
                    ontology_id: None,
                    canonical_key: None,
                    status: "active".into(),
                    metadata: json!({}),
                    provenance: json!({}),
                })
                .await
                .unwrap();
        }
        let activity_id = format!("activity-{suffix}");
        repository
            .upsert_activity(&ActivityUpsert {
                id: activity_id.clone(),
                project_id: project_id.clone(),
                study_id: Some(study_id.clone()),
                kind: "assay".into(),
                label: "qPCR".into(),
                status: "completed".into(),
                started_at: None,
                ended_at: None,
                parameters: json!({}),
                provenance: json!({}),
            })
            .await
            .unwrap();
        repository
            .upsert_activity_io(&ActivityIoUpsert {
                activity_id: activity_id.clone(),
                entity_id: sample_id.clone(),
                direction: "input".into(),
                role: "sample".into(),
                ordinal: 0,
                metadata: json!({}),
            })
            .await
            .unwrap();
        repository
            .upsert_activity_io(&ActivityIoUpsert {
                activity_id: activity_id.clone(),
                entity_id: result_id.clone(),
                direction: "output".into(),
                role: "measurement".into(),
                ordinal: 0,
                metadata: json!({}),
            })
            .await
            .unwrap();
        repository
            .upsert_activity_actor(&ActivityActorUpsert {
                activity_id: activity_id.clone(),
                actor_type: "agent".into(),
                actor_id: "test-agent".into(),
                role: "executor".into(),
                metadata: json!({"model":"fixture"}),
            })
            .await
            .unwrap();

        let resource_id = format!("resource-{suffix}");
        repository
            .upsert_resource(&ResourceUpsert {
                id: resource_id.clone(),
                kind: "Dataset".into(),
                metadata: json!({"title":"Result data"}),
                spec: json!({}),
                status: "registered".into(),
                provenance: json!({}),
                permissions: ResourcePermissions::default(),
            })
            .await
            .unwrap();
        let revision_id = format!("revision-one-{suffix}");
        assert!(
            repository
                .create_resource_revision(&ResourceRevisionCreate {
                    id: format!("revision-one-with-parent-{suffix}"),
                    resource_id: resource_id.clone(),
                    revision: 1,
                    parent_revision_id: Some(format!("impossible-parent-{suffix}")),
                    content_sha256: Some("a".repeat(64)),
                    metadata: json!({}),
                    spec: json!({}),
                    provenance: json!({}),
                    created_by: Some(user_id.clone()),
                })
                .await
                .is_err()
        );
        let revision_one = repository
            .create_resource_revision(&ResourceRevisionCreate {
                id: revision_id.clone(),
                resource_id: resource_id.clone(),
                revision: 1,
                parent_revision_id: None,
                content_sha256: Some("a".repeat(64)),
                metadata: json!({}),
                spec: json!({}),
                provenance: json!({}),
                created_by: Some(user_id.clone()),
            })
            .await
            .unwrap();
        assert_eq!(revision_one.revision, 1);
        assert_eq!(revision_one.parent_revision_id, None);
        assert_eq!(revision_one.content_sha256, Some("a".repeat(64)));
        assert_eq!(
            repository
                .get_resource_revision(&resource_id, 1)
                .await
                .unwrap()
                .unwrap()
                .id,
            revision_id
        );

        let revision_two_id = format!("revision-two-{suffix}");
        let revision_two = repository
            .create_resource_revision(&ResourceRevisionCreate {
                id: revision_two_id.clone(),
                resource_id: resource_id.clone(),
                revision: 2,
                parent_revision_id: Some(revision_id.clone()),
                content_sha256: Some("b".repeat(64)),
                metadata: json!({"stage":"normalized"}),
                spec: json!({"format":"parquet"}),
                provenance: json!({"pipeline":"fixture","version":"1"}),
                created_by: Some(user_id.clone()),
            })
            .await
            .unwrap();
        assert_eq!(
            revision_two.parent_revision_id.as_deref(),
            Some(revision_id.as_str())
        );
        let revisions = repository
            .list_resource_revisions(&resource_id, 10)
            .await
            .unwrap();
        assert_eq!(
            revisions
                .iter()
                .map(|revision| revision.revision)
                .collect::<Vec<_>>(),
            vec![2, 1]
        );

        assert!(
            repository
                .create_resource_revision(&ResourceRevisionCreate {
                    id: format!("revision-gap-{suffix}"),
                    resource_id: resource_id.clone(),
                    revision: 4,
                    parent_revision_id: Some(revision_two_id.clone()),
                    content_sha256: Some("c".repeat(64)),
                    metadata: json!({}),
                    spec: json!({}),
                    provenance: json!({}),
                    created_by: Some(user_id.clone()),
                })
                .await
                .is_err()
        );
        assert!(
            repository
                .create_resource_revision(&ResourceRevisionCreate {
                    id: format!("revision-wrong-parent-{suffix}"),
                    resource_id: resource_id.clone(),
                    revision: 3,
                    parent_revision_id: Some(revision_id.clone()),
                    content_sha256: Some("c".repeat(64)),
                    metadata: json!({}),
                    spec: json!({}),
                    provenance: json!({}),
                    created_by: Some(user_id.clone()),
                })
                .await
                .is_err()
        );
        assert!(
            repository
                .create_resource_revision(&ResourceRevisionCreate {
                    id: format!("revision-two-duplicate-{suffix}"),
                    resource_id: resource_id.clone(),
                    revision: 2,
                    parent_revision_id: Some(revision_id.clone()),
                    content_sha256: Some("b".repeat(64)),
                    metadata: json!({}),
                    spec: json!({}),
                    provenance: json!({}),
                    created_by: Some(user_id.clone()),
                })
                .await
                .is_err()
        );
        repository
            .bind_project_resource(&ProjectResourceBindingUpsert {
                project_id: project_id.clone(),
                resource_id: resource_id.clone(),
                role: "result".into(),
                added_by: Some(user_id.clone()),
            })
            .await
            .unwrap();
        repository
            .bind_resource_graph(&ResourceGraphBindingUpsert {
                resource_id: resource_id.clone(),
                entity_id: result_id.clone(),
                role: "primary".into(),
                revision_id: Some(revision_two_id.clone()),
            })
            .await
            .unwrap();

        let association_one = format!("association-one-{suffix}");
        let association_two = format!("association-two-{suffix}");
        for (id, subject, predicate, object) in [
            (&association_one, &sample_id, "derived_from", &subject_id),
            (&association_two, &result_id, "generated_from", &sample_id),
        ] {
            repository
                .upsert_graph_association(&GraphAssociationUpsert {
                    id: id.clone(),
                    project_id: Some(project_id.clone()),
                    subject_id: subject.clone(),
                    predicate: predicate.into(),
                    object_id: object.clone(),
                    qualifiers: json!({}),
                    polarity: "positive".into(),
                    knowledge_level: "observation".into(),
                    status: "validated".into(),
                    scope: "project".into(),
                    provenance: json!({}),
                    created_by: Some(user_id.clone()),
                })
                .await
                .unwrap();
        }
        let evidence_id = format!("evidence-{suffix}");
        repository
            .create_evidence_item(&EvidenceItemCreate {
                id: evidence_id.clone(),
                project_id: Some(project_id.clone()),
                evidence_type: "experiment".into(),
                source_uri: Some("artifact://fixture".into()),
                source_id: None,
                locator: json!({"row":1}),
                statistics: json!({"p_value":0.01}),
                provenance: json!({"activity_id":activity_id}),
                created_by: Some(user_id.clone()),
            })
            .await
            .unwrap();
        repository
            .link_association_evidence(&AssociationEvidenceUpsert {
                association_id: association_two.clone(),
                evidence_id: evidence_id.clone(),
                stance: "supporting".into(),
                weight: Some(0.9),
                note: None,
            })
            .await
            .unwrap();
        let other_project_id = format!("other-project-{suffix}");
        repository
            .create_project(&ProjectUpsert {
                id: other_project_id.clone(),
                name: "Other project".into(),
                description: String::new(),
                owner_user_id: user_id.clone(),
                visibility: "private".into(),
                status: "active".into(),
                metadata: json!({}),
            })
            .await
            .unwrap();

        let raw_artifact_id = format!("raw-artifact-{suffix}");
        let raw_sha256 = "d".repeat(64);
        let raw_artifact = ArtifactUpsert {
            id: raw_artifact_id.clone(),
            resource_id: resource_id.clone(),
            uri: "/data/fixture.raw.tsv".into(),
            format: "tsv".into(),
            size: Some(42),
            checksum: Some(format!("sha256:{raw_sha256}")),
            storage_backend: "local".into(),
            data_class: "raw".into(),
            immutable: true,
            content_sha256: Some(raw_sha256.clone()),
            source_uri: Some("https://example.test/fixture.raw.tsv".into()),
            derived_from: json!([]),
            pipeline_version: None,
            retention_policy: Some("retain".into()),
            storage_uri: Some("/data/fixture.raw.tsv".into()),
            schema_json: json!({"role":"raw"}),
            provenance: json!({"source":"integration-test","integrity_status":"verified"}),
        };
        let stored_raw = repository.upsert_artifact(&raw_artifact).await.unwrap();
        assert_eq!(stored_raw.checksum, raw_artifact.checksum);
        assert_eq!(stored_raw.content_sha256, Some(raw_sha256));
        assert_eq!(stored_raw.provenance, raw_artifact.provenance);

        let derived_artifact_id = format!("derived-artifact-{suffix}");
        let derived_artifact = ArtifactUpsert {
            id: derived_artifact_id.clone(),
            resource_id: resource_id.clone(),
            uri: "/data/fixture.normalized.parquet".into(),
            format: "parquet".into(),
            size: Some(21),
            checksum: Some("e".repeat(64)),
            storage_backend: "local".into(),
            data_class: "derived".into(),
            immutable: true,
            content_sha256: Some("e".repeat(64)),
            source_uri: Some("/data/fixture.raw.tsv".into()),
            derived_from: json!([raw_artifact_id.clone()]),
            pipeline_version: Some("normalize-v1".into()),
            retention_policy: Some("retain".into()),
            storage_uri: Some("/data/fixture.normalized.parquet".into()),
            schema_json: json!({"role":"normalized"}),
            provenance: json!({"activity_id":activity_id,"software":"fixture-normalizer"}),
        };
        repository.upsert_artifact(&derived_artifact).await.unwrap();
        let stored_derived = repository
            .get_artifact(&derived_artifact_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored_derived.derived_from, derived_artifact.derived_from);
        assert_eq!(stored_derived.provenance, derived_artifact.provenance);
        assert_eq!(
            repository.list_artifacts(&resource_id).await.unwrap().len(),
            2
        );

        let mut missing_lineage = derived_artifact.clone();
        missing_lineage.id = format!("missing-lineage-{suffix}");
        missing_lineage.derived_from = json!([format!("missing-artifact-{suffix}")]);
        assert!(repository.upsert_artifact(&missing_lineage).await.is_err());

        let mut self_lineage = derived_artifact.clone();
        self_lineage.id = format!("self-lineage-{suffix}");
        self_lineage.derived_from = json!([self_lineage.id.clone()]);
        assert!(repository.upsert_artifact(&self_lineage).await.is_err());

        let mut invalid_lineage_shape = derived_artifact.clone();
        invalid_lineage_shape.id = format!("invalid-lineage-shape-{suffix}");
        invalid_lineage_shape.derived_from = json!([42]);
        assert!(
            repository
                .upsert_artifact(&invalid_lineage_shape)
                .await
                .is_err()
        );

        let mutable_parent_id = format!("mutable-parent-{suffix}");
        repository
            .upsert_artifact(&ArtifactUpsert {
                id: mutable_parent_id.clone(),
                resource_id: resource_id.clone(),
                uri: "/data/mutable.tmp".into(),
                format: "tmp".into(),
                size: None,
                checksum: None,
                storage_backend: "local".into(),
                data_class: "staging".into(),
                immutable: false,
                content_sha256: None,
                source_uri: None,
                derived_from: json!([]),
                pipeline_version: None,
                retention_policy: Some("ephemeral".into()),
                storage_uri: Some("/data/mutable.tmp".into()),
                schema_json: json!({}),
                provenance: json!({"purpose":"staging"}),
            })
            .await
            .unwrap();
        let mut mutable_parent_lineage = derived_artifact.clone();
        mutable_parent_lineage.id = format!("mutable-parent-lineage-{suffix}");
        mutable_parent_lineage.derived_from = json!([mutable_parent_id.clone()]);
        assert!(
            repository
                .upsert_artifact(&mutable_parent_lineage)
                .await
                .is_err()
        );

        // Existing installations may contain mutable lineage created before
        // migration 0018. Simulate that legacy row inside a transaction, then
        // prove the new DELETE trigger preserves its referenced parent while
        // still allowing cleanup once the lineage edge is gone.
        let legacy_child_id = format!("legacy-mutable-child-{suffix}");
        let mut legacy_tx = repository.pool.begin().await.unwrap();
        sqlx::query("ALTER TABLE artifacts DISABLE TRIGGER artifacts_provenance_integrity")
            .execute(&mut *legacy_tx)
            .await
            .unwrap();
        sqlx::query("INSERT INTO artifacts (id,resource_id,uri,format,storage_backend,data_class,immutable,derived_from,schema_json,provenance) VALUES ($1,$2,$3,'tmp','local','derived',FALSE,$4,'{}'::jsonb,'{}'::jsonb)")
            .bind(&legacy_child_id)
            .bind(&resource_id)
            .bind("/data/legacy-child.tmp")
            .bind(json!([mutable_parent_id.clone()]))
            .execute(&mut *legacy_tx)
            .await
            .unwrap();
        sqlx::query("ALTER TABLE artifacts ENABLE TRIGGER artifacts_provenance_integrity")
            .execute(&mut *legacy_tx)
            .await
            .unwrap();
        legacy_tx.commit().await.unwrap();

        let referenced_mutable_delete = sqlx::query("DELETE FROM artifacts WHERE id=$1")
            .bind(&mutable_parent_id)
            .execute(&repository.pool)
            .await;
        assert!(referenced_mutable_delete.is_err());
        sqlx::query("DELETE FROM artifacts WHERE id=$1")
            .bind(&legacy_child_id)
            .execute(&repository.pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM artifacts WHERE id=$1")
            .bind(&mutable_parent_id)
            .execute(&repository.pool)
            .await
            .unwrap();

        let mut tampered_raw = raw_artifact.clone();
        tampered_raw.provenance = json!({"source":"tampered"});
        assert!(repository.upsert_artifact(&tampered_raw).await.is_err());

        let other_resource_id = format!("other-resource-{suffix}");
        repository
            .upsert_resource(&ResourceUpsert {
                id: other_resource_id.clone(),
                kind: "Dataset".into(),
                metadata: json!({"title":"Other project data"}),
                spec: json!({}),
                status: "registered".into(),
                provenance: json!({}),
                permissions: ResourcePermissions::default(),
            })
            .await
            .unwrap();
        repository
            .bind_project_resource(&ProjectResourceBindingUpsert {
                project_id: other_project_id.clone(),
                resource_id: other_resource_id.clone(),
                role: "input".into(),
                added_by: Some(user_id.clone()),
            })
            .await
            .unwrap();
        let other_raw_artifact_id = format!("other-raw-artifact-{suffix}");
        repository
            .upsert_artifact(&ArtifactUpsert {
                id: other_raw_artifact_id.clone(),
                resource_id: other_resource_id,
                uri: "/data/other.raw.tsv".into(),
                format: "tsv".into(),
                size: Some(9),
                checksum: Some("f".repeat(64)),
                storage_backend: "local".into(),
                data_class: "raw".into(),
                immutable: true,
                content_sha256: Some("f".repeat(64)),
                source_uri: None,
                derived_from: json!([]),
                pipeline_version: None,
                retention_policy: Some("retain".into()),
                storage_uri: Some("/data/other.raw.tsv".into()),
                schema_json: json!({}),
                provenance: json!({"project":other_project_id.clone()}),
            })
            .await
            .unwrap();
        let mut cross_resource_lineage = derived_artifact.clone();
        cross_resource_lineage.id = format!("cross-resource-lineage-{suffix}");
        cross_resource_lineage.derived_from = json!([other_raw_artifact_id.clone()]);
        let stored_cross_resource = repository
            .upsert_artifact(&cross_resource_lineage)
            .await
            .unwrap();
        assert_eq!(
            stored_cross_resource.derived_from,
            json!([other_raw_artifact_id])
        );

        let visible_in_project: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM artifacts a JOIN project_resource_bindings b ON b.resource_id=a.resource_id WHERE a.id=$1 AND b.project_id=$2",
        )
        .bind(&derived_artifact_id)
        .bind(&project_id)
        .fetch_one(&repository.pool)
        .await
        .unwrap();
        let visible_cross_project: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM artifacts a JOIN project_resource_bindings b ON b.resource_id=a.resource_id WHERE a.id=$1 AND b.project_id=$2",
        )
        .bind(&derived_artifact_id)
        .bind(&other_project_id)
        .fetch_one(&repository.pool)
        .await
        .unwrap();
        assert_eq!(visible_in_project, 1);
        assert_eq!(visible_cross_project, 0);

        let foreign_evidence_id = format!("foreign-evidence-{suffix}");
        repository
            .create_evidence_item(&EvidenceItemCreate {
                id: foreign_evidence_id.clone(),
                project_id: Some(other_project_id.clone()),
                evidence_type: "analysis".into(),
                source_uri: None,
                source_id: Some("foreign".into()),
                locator: json!({}),
                statistics: json!({}),
                provenance: json!({}),
                created_by: Some(user_id.clone()),
            })
            .await
            .unwrap();
        assert!(
            repository
                .link_association_evidence(&AssociationEvidenceUpsert {
                    association_id: association_two,
                    evidence_id: foreign_evidence_id,
                    stance: "contradicting".into(),
                    weight: Some(0.5),
                    note: None,
                })
                .await
                .is_err()
        );

        let subgraph = repository
            .research_subgraph(&subject_id, 2, 100)
            .await
            .unwrap();
        assert_eq!(subgraph.entities.len(), 3);
        assert_eq!(subgraph.associations.len(), 2);
        let context = repository
            .project_context_pack(&project_id, 100)
            .await
            .unwrap();
        assert_eq!(context.project.id, project_id);
        assert_eq!(context.activities.len(), 1);
        assert_eq!(context.evidence.len(), 1);
        assert_eq!(context.resources.len(), 1);

        let immutable =
            sqlx::query("UPDATE resource_revisions SET metadata='{}'::jsonb WHERE id=$1")
                .bind(&revision_id)
                .execute(&repository.pool)
                .await;
        assert!(immutable.is_err());
        let immutable_delete = sqlx::query("DELETE FROM resource_revisions WHERE id=$1")
            .bind(&revision_id)
            .execute(&repository.pool)
            .await;
        assert!(immutable_delete.is_err());
        let immutable_artifact_delete = sqlx::query("DELETE FROM artifacts WHERE id=$1")
            .bind(&raw_artifact_id)
            .execute(&repository.pool)
            .await;
        assert!(immutable_artifact_delete.is_err());
        assert!(
            repository
                .research_subgraph(&subject_id, 4, 10)
                .await
                .is_err()
        );
        assert!(
            repository
                .research_subgraph(&subject_id, 1, 1_001)
                .await
                .is_err()
        );
        repository.pool.close().await;
        sqlx::query(&format!("DROP DATABASE {database_name} WITH (FORCE)"))
            .execute(&admin_pool)
            .await
            .unwrap();
        admin_pool.close().await;
    }
}

impl ResourceRepository {
    pub async fn bind_project_resource(
        &self,
        value: &ProjectResourceBindingUpsert,
    ) -> Result<ProjectResourceBinding, sqlx::Error> {
        sqlx::query_as("INSERT INTO project_resource_bindings(project_id,resource_id,role,added_by) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,resource_id,role) DO UPDATE SET added_by=EXCLUDED.added_by RETURNING project_id,resource_id,role,added_by,created_at")
            .bind(&value.project_id).bind(&value.resource_id).bind(&value.role).bind(&value.added_by).fetch_one(&self.pool).await
    }

    pub async fn unbind_project_resource(
        &self,
        project_id: &str,
        resource_id: &str,
        role: &str,
    ) -> Result<bool, sqlx::Error> {
        Ok(sqlx::query("DELETE FROM project_resource_bindings WHERE project_id=$1 AND resource_id=$2 AND role=$3")
            .bind(project_id).bind(resource_id).bind(role).execute(&self.pool).await?.rows_affected() == 1)
    }

    pub async fn list_project_resource_bindings(
        &self,
        project_id: &str,
        limit: i64,
    ) -> Result<Vec<ProjectResourceBinding>, sqlx::Error> {
        let limit = checked_limit(limit)?;
        sqlx::query_as("SELECT project_id,resource_id,role,added_by,created_at FROM project_resource_bindings WHERE project_id=$1 ORDER BY created_at DESC,resource_id,role LIMIT $2")
            .bind(project_id).bind(limit).fetch_all(&self.pool).await
    }

    pub async fn list_project_resources(
        &self,
        project_id: &str,
        limit: i64,
    ) -> Result<Vec<Resource>, sqlx::Error> {
        let limit = checked_limit(limit)?;
        sqlx::query_as("SELECT DISTINCT r.id,r.kind,r.metadata,r.spec,r.status,r.provenance,r.permissions,r.created_at,r.updated_at FROM resources r JOIN project_resource_bindings b ON b.resource_id=r.id WHERE b.project_id=$1 ORDER BY r.id LIMIT $2")
            .bind(project_id).bind(limit).fetch_all(&self.pool).await
    }

    pub async fn bind_resource_graph(
        &self,
        value: &ResourceGraphBindingUpsert,
    ) -> Result<ResourceGraphBinding, sqlx::Error> {
        sqlx::query_as("INSERT INTO resource_graph_bindings(resource_id,entity_id,role,revision_id) VALUES($1,$2,$3,$4) ON CONFLICT(resource_id,entity_id,role) DO UPDATE SET revision_id=EXCLUDED.revision_id RETURNING resource_id,entity_id,role,revision_id,created_at")
            .bind(&value.resource_id).bind(&value.entity_id).bind(&value.role).bind(&value.revision_id).fetch_one(&self.pool).await
    }

    pub async fn unbind_resource_graph(
        &self,
        resource_id: &str,
        entity_id: &str,
        role: &str,
    ) -> Result<bool, sqlx::Error> {
        Ok(sqlx::query(
            "DELETE FROM resource_graph_bindings WHERE resource_id=$1 AND entity_id=$2 AND role=$3",
        )
        .bind(resource_id)
        .bind(entity_id)
        .bind(role)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    pub async fn list_resource_graph_bindings(
        &self,
        resource_id: &str,
        limit: i64,
    ) -> Result<Vec<ResourceGraphBinding>, sqlx::Error> {
        let limit = checked_limit(limit)?;
        sqlx::query_as("SELECT resource_id,entity_id,role,revision_id,created_at FROM resource_graph_bindings WHERE resource_id=$1 ORDER BY created_at DESC,entity_id,role LIMIT $2")
            .bind(resource_id).bind(limit).fetch_all(&self.pool).await
    }

    pub async fn list_entity_resource_bindings(
        &self,
        entity_id: &str,
        limit: i64,
    ) -> Result<Vec<ResourceGraphBinding>, sqlx::Error> {
        let limit = checked_limit(limit)?;
        sqlx::query_as("SELECT resource_id,entity_id,role,revision_id,created_at FROM resource_graph_bindings WHERE entity_id=$1 ORDER BY created_at DESC,resource_id,role LIMIT $2")
            .bind(entity_id).bind(limit).fetch_all(&self.pool).await
    }

    pub async fn research_subgraph(
        &self,
        root_entity_id: &str,
        depth: u8,
        limit: i64,
    ) -> Result<ResearchSubgraph, sqlx::Error> {
        let depth_value = checked_depth(depth)?;
        let limit = checked_limit(limit)?;
        let root = self
            .get_research_entity(root_entity_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;
        let fetch_limit = limit + 1;
        let mut entity_ids: Vec<String> = sqlx::query_scalar(
            "WITH RECURSIVE walk(entity_id,depth) AS (SELECT $1::text,0 UNION SELECT CASE WHEN a.subject_id=w.entity_id THEN a.object_id ELSE a.subject_id END,w.depth+1 FROM walk w JOIN graph_associations a ON (a.subject_id=w.entity_id OR a.object_id=w.entity_id) WHERE w.depth<$2 AND a.status NOT IN ('retracted','superseded') AND (($3::text IS NULL AND a.scope='public') OR ($3::text IS NOT NULL AND (a.scope='public' OR a.project_id=$3)))) SELECT entity_id FROM walk GROUP BY entity_id ORDER BY MIN(depth),entity_id LIMIT $4",
        )
        .bind(root_entity_id)
        .bind(depth_value)
        .bind(root.project_id.as_deref())
        .bind(fetch_limit)
        .fetch_all(&self.pool)
        .await?;
        let mut truncated = truncate_rows(&mut entity_ids, limit);
        let mut entities: Vec<ResearchEntity> = sqlx::query_as("SELECT id,project_id,study_id,category,kind,label,ontology_id,canonical_key,status,metadata,provenance,created_at,updated_at FROM research_entities WHERE id=ANY($1) ORDER BY id")
            .bind(&entity_ids).fetch_all(&self.pool).await?;
        let mut associations: Vec<GraphAssociation> = sqlx::query_as("SELECT id,project_id,subject_id,predicate,object_id,qualifiers,polarity,knowledge_level,status,scope,provenance,created_by,created_at,updated_at FROM graph_associations WHERE subject_id=ANY($1) AND object_id=ANY($1) AND status NOT IN ('retracted','superseded') AND (($2::text IS NULL AND scope='public') OR ($2::text IS NOT NULL AND (scope='public' OR project_id=$2))) ORDER BY predicate,subject_id,object_id,id LIMIT $3")
            .bind(&entity_ids).bind(root.project_id.as_deref()).bind(fetch_limit).fetch_all(&self.pool).await?;
        truncated |= truncate_rows(&mut entities, limit);
        truncated |= truncate_rows(&mut associations, limit);
        Ok(ResearchSubgraph {
            root_entity_id: root_entity_id.to_owned(),
            depth,
            truncated,
            entities,
            associations,
        })
    }

    pub async fn project_context_pack(
        &self,
        project_id: &str,
        limit: i64,
    ) -> Result<ProjectContextPack, sqlx::Error> {
        let limit = checked_limit(limit)?;
        let fetch_limit = limit + 1;
        let mut transaction = self.pool.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *transaction)
            .await?;
        let project: Project = sqlx::query_as("SELECT id,name,description,owner_user_id,visibility,status,metadata,created_at,updated_at FROM projects WHERE id=$1")
            .bind(project_id).fetch_one(&mut *transaction).await?;
        let mut studies: Vec<Study> = sqlx::query_as("SELECT id,project_id,name,description,design_type,status,metadata,provenance,created_at,updated_at FROM studies WHERE project_id=$1 ORDER BY updated_at DESC,id LIMIT $2")
            .bind(project_id).bind(fetch_limit).fetch_all(&mut *transaction).await?;
        let mut entities: Vec<ResearchEntity> = sqlx::query_as("SELECT id,project_id,study_id,category,kind,label,ontology_id,canonical_key,status,metadata,provenance,created_at,updated_at FROM research_entities WHERE project_id=$1 OR id IN (SELECT subject_id FROM graph_associations WHERE project_id=$1 UNION SELECT object_id FROM graph_associations WHERE project_id=$1) ORDER BY project_id NULLS LAST,id LIMIT $2")
            .bind(project_id).bind(fetch_limit).fetch_all(&mut *transaction).await?;
        let mut activities: Vec<Activity> = sqlx::query_as("SELECT id,project_id,study_id,kind,label,status,started_at,ended_at,parameters,provenance,created_at,updated_at FROM research_activities WHERE project_id=$1 ORDER BY updated_at DESC,id LIMIT $2")
            .bind(project_id).bind(fetch_limit).fetch_all(&mut *transaction).await?;
        let mut activity_io: Vec<ActivityIo> = sqlx::query_as("SELECT io.activity_id,io.entity_id,io.direction,io.role,io.ordinal,io.metadata,io.created_at FROM activity_io io JOIN research_activities a ON a.id=io.activity_id WHERE a.project_id=$1 ORDER BY io.activity_id,io.direction,io.ordinal LIMIT $2")
            .bind(project_id).bind(fetch_limit).fetch_all(&mut *transaction).await?;
        let mut activity_actors: Vec<ActivityActor> = sqlx::query_as("SELECT aa.activity_id,aa.actor_type,aa.actor_id,aa.role,aa.metadata,aa.created_at FROM activity_actors aa JOIN research_activities a ON a.id=aa.activity_id WHERE a.project_id=$1 ORDER BY aa.activity_id,aa.role LIMIT $2")
            .bind(project_id).bind(fetch_limit).fetch_all(&mut *transaction).await?;
        let mut associations: Vec<GraphAssociation> = sqlx::query_as("SELECT id,project_id,subject_id,predicate,object_id,qualifiers,polarity,knowledge_level,status,scope,provenance,created_by,created_at,updated_at FROM graph_associations WHERE project_id=$1 ORDER BY updated_at DESC,id LIMIT $2")
            .bind(project_id).bind(fetch_limit).fetch_all(&mut *transaction).await?;
        let association_ids: Vec<String> =
            associations.iter().map(|value| value.id.clone()).collect();
        let mut evidence: Vec<EvidenceItem> = sqlx::query_as("SELECT DISTINCT e.id,e.project_id,e.evidence_type,e.source_uri,e.source_id,e.locator,e.statistics,e.provenance,e.created_by,e.created_at FROM evidence_items e JOIN association_evidence ae ON ae.evidence_id=e.id WHERE ae.association_id=ANY($1) ORDER BY e.created_at DESC,e.id LIMIT $2")
            .bind(&association_ids).bind(fetch_limit).fetch_all(&mut *transaction).await?;
        let mut association_evidence: Vec<AssociationEvidence> = sqlx::query_as("SELECT association_id,evidence_id,stance,weight,note,created_at FROM association_evidence WHERE association_id=ANY($1) ORDER BY association_id,stance,evidence_id LIMIT $2")
            .bind(&association_ids).bind(fetch_limit).fetch_all(&mut *transaction).await?;
        let mut project_resources: Vec<ProjectResourceBinding> = sqlx::query_as("SELECT project_id,resource_id,role,added_by,created_at FROM project_resource_bindings WHERE project_id=$1 ORDER BY created_at DESC,resource_id LIMIT $2")
            .bind(project_id).bind(fetch_limit).fetch_all(&mut *transaction).await?;
        let resource_ids: Vec<String> = project_resources
            .iter()
            .map(|value| value.resource_id.clone())
            .collect();
        let mut resources: Vec<Resource> = sqlx::query_as("SELECT id,kind,metadata,spec,status,provenance,permissions,created_at,updated_at FROM resources WHERE id=ANY($1) ORDER BY id LIMIT $2")
            .bind(&resource_ids).bind(fetch_limit).fetch_all(&mut *transaction).await?;
        let mut resource_revisions: Vec<ResourceRevision> = sqlx::query_as("SELECT id,resource_id,revision,parent_revision_id,content_sha256,metadata,spec,provenance,created_by,created_at FROM resource_revisions WHERE resource_id=ANY($1) ORDER BY resource_id,revision DESC LIMIT $2")
            .bind(&resource_ids).bind(fetch_limit).fetch_all(&mut *transaction).await?;
        let entity_ids: Vec<String> = entities.iter().map(|value| value.id.clone()).collect();
        let mut resource_graph_bindings: Vec<ResourceGraphBinding> = sqlx::query_as("SELECT b.resource_id,b.entity_id,b.role,b.revision_id,b.created_at FROM resource_graph_bindings b WHERE b.resource_id=ANY($1) OR b.entity_id=ANY($2) ORDER BY b.created_at DESC,b.resource_id,b.entity_id LIMIT $3")
            .bind(&resource_ids).bind(&entity_ids).bind(fetch_limit).fetch_all(&mut *transaction).await?;
        transaction.commit().await?;

        let mut truncated = false;
        truncated |= truncate_rows(&mut studies, limit);
        truncated |= truncate_rows(&mut entities, limit);
        truncated |= truncate_rows(&mut activities, limit);
        truncated |= truncate_rows(&mut activity_io, limit);
        truncated |= truncate_rows(&mut activity_actors, limit);
        truncated |= truncate_rows(&mut associations, limit);
        truncated |= truncate_rows(&mut evidence, limit);
        truncated |= truncate_rows(&mut association_evidence, limit);
        truncated |= truncate_rows(&mut project_resources, limit);
        truncated |= truncate_rows(&mut resources, limit);
        truncated |= truncate_rows(&mut resource_revisions, limit);
        truncated |= truncate_rows(&mut resource_graph_bindings, limit);
        Ok(ProjectContextPack {
            project,
            studies,
            entities,
            activities,
            activity_io,
            activity_actors,
            associations,
            evidence,
            association_evidence,
            resources,
            project_resources,
            resource_revisions,
            resource_graph_bindings,
            truncated,
        })
    }
}

impl ResourceRepository {
    pub async fn upsert_activity(&self, value: &ActivityUpsert) -> Result<Activity, sqlx::Error> {
        sqlx::query_as(
            "INSERT INTO research_activities(id,project_id,study_id,kind,label,status,started_at,ended_at,parameters,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET kind=EXCLUDED.kind,label=EXCLUDED.label,status=EXCLUDED.status,started_at=EXCLUDED.started_at,ended_at=EXCLUDED.ended_at,parameters=EXCLUDED.parameters,provenance=EXCLUDED.provenance,updated_at=NOW() WHERE research_activities.project_id=EXCLUDED.project_id AND research_activities.study_id IS NOT DISTINCT FROM EXCLUDED.study_id RETURNING id,project_id,study_id,kind,label,status,started_at,ended_at,parameters,provenance,created_at,updated_at",
        )
        .bind(&value.id)
        .bind(&value.project_id)
        .bind(&value.study_id)
        .bind(&value.kind)
        .bind(&value.label)
        .bind(&value.status)
        .bind(value.started_at)
        .bind(value.ended_at)
        .bind(&value.parameters)
        .bind(&value.provenance)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn get_activity(&self, id: &str) -> Result<Option<Activity>, sqlx::Error> {
        sqlx::query_as("SELECT id,project_id,study_id,kind,label,status,started_at,ended_at,parameters,provenance,created_at,updated_at FROM research_activities WHERE id=$1")
            .bind(id).fetch_optional(&self.pool).await
    }

    pub async fn list_activities(
        &self,
        project_id: &str,
        study_id: Option<&str>,
        status: Option<&str>,
        limit: i64,
    ) -> Result<Vec<Activity>, sqlx::Error> {
        let limit = checked_limit(limit)?;
        sqlx::query_as("SELECT id,project_id,study_id,kind,label,status,started_at,ended_at,parameters,provenance,created_at,updated_at FROM research_activities WHERE project_id=$1 AND ($2::text IS NULL OR study_id=$2) AND ($3::text IS NULL OR status=$3) ORDER BY updated_at DESC,id LIMIT $4")
            .bind(project_id).bind(study_id).bind(status).bind(limit).fetch_all(&self.pool).await
    }

    pub async fn upsert_activity_io(
        &self,
        value: &ActivityIoUpsert,
    ) -> Result<ActivityIo, sqlx::Error> {
        sqlx::query_as("INSERT INTO activity_io(activity_id,entity_id,direction,role,ordinal,metadata) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(activity_id,entity_id,direction,role) DO UPDATE SET ordinal=EXCLUDED.ordinal,metadata=EXCLUDED.metadata RETURNING activity_id,entity_id,direction,role,ordinal,metadata,created_at")
            .bind(&value.activity_id).bind(&value.entity_id).bind(&value.direction).bind(&value.role).bind(value.ordinal).bind(&value.metadata).fetch_one(&self.pool).await
    }

    pub async fn list_activity_io(
        &self,
        activity_id: &str,
    ) -> Result<Vec<ActivityIo>, sqlx::Error> {
        sqlx::query_as("SELECT activity_id,entity_id,direction,role,ordinal,metadata,created_at FROM activity_io WHERE activity_id=$1 ORDER BY direction,ordinal,role,entity_id")
            .bind(activity_id).fetch_all(&self.pool).await
    }

    pub async fn upsert_activity_actor(
        &self,
        value: &ActivityActorUpsert,
    ) -> Result<ActivityActor, sqlx::Error> {
        sqlx::query_as("INSERT INTO activity_actors(activity_id,actor_type,actor_id,role,metadata) VALUES($1,$2,$3,$4,$5) ON CONFLICT(activity_id,actor_type,actor_id,role) DO UPDATE SET metadata=EXCLUDED.metadata RETURNING activity_id,actor_type,actor_id,role,metadata,created_at")
            .bind(&value.activity_id).bind(&value.actor_type).bind(&value.actor_id).bind(&value.role).bind(&value.metadata).fetch_one(&self.pool).await
    }

    pub async fn list_activity_actors(
        &self,
        activity_id: &str,
    ) -> Result<Vec<ActivityActor>, sqlx::Error> {
        sqlx::query_as("SELECT activity_id,actor_type,actor_id,role,metadata,created_at FROM activity_actors WHERE activity_id=$1 ORDER BY role,actor_type,actor_id")
            .bind(activity_id).fetch_all(&self.pool).await
    }

    pub async fn create_resource_revision(
        &self,
        value: &ResourceRevisionCreate,
    ) -> Result<ResourceRevision, sqlx::Error> {
        sqlx::query_as("INSERT INTO resource_revisions(id,resource_id,revision,parent_revision_id,content_sha256,metadata,spec,provenance,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,resource_id,revision,parent_revision_id,content_sha256,metadata,spec,provenance,created_by,created_at")
            .bind(&value.id).bind(&value.resource_id).bind(value.revision).bind(&value.parent_revision_id).bind(&value.content_sha256).bind(&value.metadata).bind(&value.spec).bind(&value.provenance).bind(&value.created_by).fetch_one(&self.pool).await
    }

    pub async fn get_resource_revision(
        &self,
        resource_id: &str,
        revision: i32,
    ) -> Result<Option<ResourceRevision>, sqlx::Error> {
        sqlx::query_as("SELECT id,resource_id,revision,parent_revision_id,content_sha256,metadata,spec,provenance,created_by,created_at FROM resource_revisions WHERE resource_id=$1 AND revision=$2")
            .bind(resource_id).bind(revision).fetch_optional(&self.pool).await
    }

    pub async fn get_resource_revision_by_id(
        &self,
        id: &str,
    ) -> Result<Option<ResourceRevision>, sqlx::Error> {
        sqlx::query_as("SELECT id,resource_id,revision,parent_revision_id,content_sha256,metadata,spec,provenance,created_by,created_at FROM resource_revisions WHERE id=$1")
            .bind(id).fetch_optional(&self.pool).await
    }

    pub async fn list_resource_revisions(
        &self,
        resource_id: &str,
        limit: i64,
    ) -> Result<Vec<ResourceRevision>, sqlx::Error> {
        let limit = checked_limit(limit)?;
        sqlx::query_as("SELECT id,resource_id,revision,parent_revision_id,content_sha256,metadata,spec,provenance,created_by,created_at FROM resource_revisions WHERE resource_id=$1 ORDER BY revision DESC LIMIT $2")
            .bind(resource_id).bind(limit).fetch_all(&self.pool).await
    }

    pub async fn upsert_graph_association(
        &self,
        value: &GraphAssociationUpsert,
    ) -> Result<GraphAssociation, sqlx::Error> {
        sqlx::query_as("INSERT INTO graph_associations(id,project_id,subject_id,predicate,object_id,qualifiers,polarity,knowledge_level,status,scope,provenance,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET qualifiers=EXCLUDED.qualifiers,polarity=EXCLUDED.polarity,knowledge_level=EXCLUDED.knowledge_level,status=EXCLUDED.status,provenance=EXCLUDED.provenance,updated_at=NOW() WHERE graph_associations.project_id IS NOT DISTINCT FROM EXCLUDED.project_id AND graph_associations.subject_id=EXCLUDED.subject_id AND graph_associations.predicate=EXCLUDED.predicate AND graph_associations.object_id=EXCLUDED.object_id AND graph_associations.scope=EXCLUDED.scope RETURNING id,project_id,subject_id,predicate,object_id,qualifiers,polarity,knowledge_level,status,scope,provenance,created_by,created_at,updated_at")
            .bind(&value.id).bind(&value.project_id).bind(&value.subject_id).bind(&value.predicate).bind(&value.object_id).bind(&value.qualifiers).bind(&value.polarity).bind(&value.knowledge_level).bind(&value.status).bind(&value.scope).bind(&value.provenance).bind(&value.created_by).fetch_one(&self.pool).await
    }

    pub async fn get_graph_association(
        &self,
        id: &str,
    ) -> Result<Option<GraphAssociation>, sqlx::Error> {
        sqlx::query_as("SELECT id,project_id,subject_id,predicate,object_id,qualifiers,polarity,knowledge_level,status,scope,provenance,created_by,created_at,updated_at FROM graph_associations WHERE id=$1")
            .bind(id).fetch_optional(&self.pool).await
    }

    pub async fn list_graph_associations(
        &self,
        project_id: Option<&str>,
        entity_id: Option<&str>,
        status: Option<&str>,
        limit: i64,
    ) -> Result<Vec<GraphAssociation>, sqlx::Error> {
        let limit = checked_limit(limit)?;
        sqlx::query_as("SELECT id,project_id,subject_id,predicate,object_id,qualifiers,polarity,knowledge_level,status,scope,provenance,created_by,created_at,updated_at FROM graph_associations WHERE (($1::text IS NULL AND scope='public') OR ($1::text IS NOT NULL AND (scope='public' OR project_id=$1))) AND ($2::text IS NULL OR subject_id=$2 OR object_id=$2) AND ($3::text IS NULL OR status=$3) ORDER BY updated_at DESC,id LIMIT $4")
            .bind(project_id).bind(entity_id).bind(status).bind(limit).fetch_all(&self.pool).await
    }

    pub async fn create_evidence_item(
        &self,
        value: &EvidenceItemCreate,
    ) -> Result<EvidenceItem, sqlx::Error> {
        sqlx::query_as("INSERT INTO evidence_items(id,project_id,evidence_type,source_uri,source_id,locator,statistics,provenance,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,project_id,evidence_type,source_uri,source_id,locator,statistics,provenance,created_by,created_at")
            .bind(&value.id).bind(&value.project_id).bind(&value.evidence_type).bind(&value.source_uri).bind(&value.source_id).bind(&value.locator).bind(&value.statistics).bind(&value.provenance).bind(&value.created_by).fetch_one(&self.pool).await
    }

    pub async fn get_evidence_item(&self, id: &str) -> Result<Option<EvidenceItem>, sqlx::Error> {
        sqlx::query_as("SELECT id,project_id,evidence_type,source_uri,source_id,locator,statistics,provenance,created_by,created_at FROM evidence_items WHERE id=$1")
            .bind(id).fetch_optional(&self.pool).await
    }

    pub async fn list_evidence_items(
        &self,
        project_id: Option<&str>,
        limit: i64,
    ) -> Result<Vec<EvidenceItem>, sqlx::Error> {
        let limit = checked_limit(limit)?;
        sqlx::query_as("SELECT id,project_id,evidence_type,source_uri,source_id,locator,statistics,provenance,created_by,created_at FROM evidence_items WHERE (($1::text IS NULL AND project_id IS NULL) OR ($1::text IS NOT NULL AND (project_id=$1 OR project_id IS NULL))) ORDER BY created_at DESC,id LIMIT $2")
            .bind(project_id).bind(limit).fetch_all(&self.pool).await
    }

    pub async fn link_association_evidence(
        &self,
        value: &AssociationEvidenceUpsert,
    ) -> Result<AssociationEvidence, sqlx::Error> {
        sqlx::query_as("INSERT INTO association_evidence(association_id,evidence_id,stance,weight,note) VALUES($1,$2,$3,$4,$5) ON CONFLICT(association_id,evidence_id) DO UPDATE SET stance=EXCLUDED.stance,weight=EXCLUDED.weight,note=EXCLUDED.note RETURNING association_id,evidence_id,stance,weight,note,created_at")
            .bind(&value.association_id).bind(&value.evidence_id).bind(&value.stance).bind(value.weight).bind(&value.note).fetch_one(&self.pool).await
    }

    pub async fn list_association_evidence(
        &self,
        association_id: &str,
    ) -> Result<Vec<AssociationEvidence>, sqlx::Error> {
        sqlx::query_as("SELECT association_id,evidence_id,stance,weight,note,created_at FROM association_evidence WHERE association_id=$1 ORDER BY stance,evidence_id")
            .bind(association_id).fetch_all(&self.pool).await
    }

    pub async fn list_evidence_for_association(
        &self,
        association_id: &str,
        limit: i64,
    ) -> Result<Vec<EvidenceItem>, sqlx::Error> {
        let limit = checked_limit(limit)?;
        sqlx::query_as("SELECT e.id,e.project_id,e.evidence_type,e.source_uri,e.source_id,e.locator,e.statistics,e.provenance,e.created_by,e.created_at FROM evidence_items e JOIN association_evidence ae ON ae.evidence_id=e.id WHERE ae.association_id=$1 ORDER BY e.created_at DESC,e.id LIMIT $2")
            .bind(association_id).bind(limit).fetch_all(&self.pool).await
    }
}
