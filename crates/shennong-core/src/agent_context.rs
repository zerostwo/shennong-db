use super::ResourceRepository;
use serde_json::Value;

impl ResourceRepository {
    pub async fn list_agent_skills(&self, owner_user_id: &str) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT jsonb_build_object(\
                'id',s.id,'slug',s.slug,'name',s.name,'description',s.description,\
                'source_kind',s.source_kind,'generation_source',s.generation_source,\
                'status',s.status,'revision',s.current_revision,\
                'content',r.content,'is_builtin',s.owner_user_id IS NULL,\
                'created_at',s.created_at,'updated_at',s.updated_at) \
             FROM agent_skills s \
             JOIN agent_skill_revisions r ON r.skill_id=s.id AND r.revision=s.current_revision \
             WHERE s.owner_user_id IS NULL OR s.owner_user_id=$1 \
             ORDER BY (s.owner_user_id IS NULL) DESC,s.name,s.id",
        )
        .bind(owner_user_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_agent_skill(
        &self,
        id: &str,
        owner_user_id: &str,
    ) -> Result<Option<Value>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT jsonb_build_object(\
                'id',s.id,'slug',s.slug,'name',s.name,'description',s.description,\
                'source_kind',s.source_kind,'generation_source',s.generation_source,\
                'status',s.status,'revision',s.current_revision,\
                'content',r.content,'is_builtin',s.owner_user_id IS NULL,\
                'created_at',s.created_at,'updated_at',s.updated_at) \
             FROM agent_skills s \
             JOIN agent_skill_revisions r ON r.skill_id=s.id AND r.revision=s.current_revision \
             WHERE s.id=$1 AND (s.owner_user_id IS NULL OR s.owner_user_id=$2)",
        )
        .bind(id)
        .bind(owner_user_id)
        .fetch_optional(&self.pool)
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_agent_skill(
        &self,
        id: &str,
        owner_user_id: &str,
        slug: &str,
        name: &str,
        description: &str,
        source_kind: &str,
        generation_source: &str,
        status: &str,
        content: &str,
    ) -> Result<Value, sqlx::Error> {
        let status = if source_kind == "generated" {
            "draft"
        } else {
            status
        };
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO agent_skills(id,owner_user_id,slug,name,description,source_kind,generation_source,status) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(id)
        .bind(owner_user_id)
        .bind(slug)
        .bind(name)
        .bind(description)
        .bind(source_kind)
        .bind(generation_source)
        .bind(status)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO agent_skill_revisions(skill_id,revision,content,change_note,created_by) \
             VALUES($1,1,$2,'Initial revision',$3)",
        )
        .bind(id)
        .bind(content)
        .bind(owner_user_id)
        .execute(&mut *tx)
        .await?;
        let value = skill_value(&mut tx, id, owner_user_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;
        tx.commit().await?;
        Ok(value)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_agent_skill(
        &self,
        id: &str,
        owner_user_id: &str,
        name: &str,
        description: &str,
        status: &str,
        content: Option<&str>,
        change_note: &str,
    ) -> Result<Option<Value>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let current: Option<i32> = sqlx::query_scalar(
            "SELECT current_revision FROM agent_skills \
             WHERE id=$1 AND owner_user_id=$2 AND source_kind<>'built_in' FOR UPDATE",
        )
        .bind(id)
        .bind(owner_user_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(current) = current else {
            tx.rollback().await?;
            return Ok(None);
        };
        let next = if let Some(content) = content {
            let next = current + 1;
            sqlx::query(
                "INSERT INTO agent_skill_revisions(skill_id,revision,content,change_note,created_by) \
                 VALUES($1,$2,$3,$4,$5)",
            )
            .bind(id)
            .bind(next)
            .bind(content)
            .bind(change_note)
            .bind(owner_user_id)
            .execute(&mut *tx)
            .await?;
            next
        } else {
            current
        };
        sqlx::query(
            "UPDATE agent_skills SET name=$3,description=$4,status=$5,current_revision=$6,updated_at=NOW() \
             WHERE id=$1 AND owner_user_id=$2",
        )
        .bind(id)
        .bind(owner_user_id)
        .bind(name)
        .bind(description)
        .bind(status)
        .bind(next)
        .execute(&mut *tx)
        .await?;
        let value = skill_value(&mut tx, id, owner_user_id).await?;
        tx.commit().await?;
        Ok(value)
    }

    pub async fn delete_agent_skill(
        &self,
        id: &str,
        owner_user_id: &str,
    ) -> Result<bool, sqlx::Error> {
        Ok(sqlx::query(
            "UPDATE agent_skills SET status='disabled',updated_at=NOW() \
             WHERE id=$1 AND owner_user_id=$2 AND source_kind<>'built_in' AND status<>'disabled'",
        )
        .bind(id)
        .bind(owner_user_id)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    pub async fn list_thread_skills(
        &self,
        thread_id: &str,
        owner_user_id: &str,
    ) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT jsonb_build_object(\
                'id',s.id,'slug',s.slug,'name',s.name,'description',s.description,\
                'source_kind',s.source_kind,'generation_source',s.generation_source,\
                'status',s.status,'revision',s.current_revision,\
                'content',r.content,'enabled',ts.enabled,'is_builtin',s.owner_user_id IS NULL) \
             FROM chat_thread_skills ts \
             JOIN chat_threads t ON t.id=ts.thread_id \
             JOIN agent_skills s ON s.id=ts.skill_id \
             JOIN agent_skill_revisions r ON r.skill_id=s.id AND r.revision=s.current_revision \
             WHERE ts.thread_id=$1 AND t.owner_user_id=$2 AND ts.enabled AND s.status='active' \
             ORDER BY s.name,s.id",
        )
        .bind(thread_id)
        .bind(owner_user_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn enable_thread_skill(
        &self,
        thread_id: &str,
        skill_id: &str,
        owner_user_id: &str,
    ) -> Result<bool, sqlx::Error> {
        Ok(sqlx::query(
            "INSERT INTO chat_thread_skills(thread_id,skill_id,enabled) \
             SELECT t.id,s.id,TRUE FROM chat_threads t JOIN agent_skills s ON s.id=$2 \
             WHERE t.id=$1 AND t.owner_user_id=$3 AND s.status='active' \
               AND (s.owner_user_id IS NULL OR s.owner_user_id=$3) \
             ON CONFLICT(thread_id,skill_id) DO UPDATE SET enabled=TRUE",
        )
        .bind(thread_id)
        .bind(skill_id)
        .bind(owner_user_id)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    pub async fn disable_thread_skill(
        &self,
        thread_id: &str,
        skill_id: &str,
        owner_user_id: &str,
    ) -> Result<bool, sqlx::Error> {
        Ok(sqlx::query(
            "DELETE FROM chat_thread_skills ts USING chat_threads t \
             WHERE ts.thread_id=t.id AND t.id=$1 AND ts.skill_id=$2 AND t.owner_user_id=$3",
        )
        .bind(thread_id)
        .bind(skill_id)
        .bind(owner_user_id)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    pub async fn list_agent_memories(
        &self,
        owner_user_id: &str,
        project_id: Option<&str>,
    ) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT jsonb_build_object(\
                'id',m.id,'project_id',m.project_id,'title',m.title,'source_kind',m.source_kind,\
                'source_id',m.source_id,'status',m.status,'revision',m.current_revision,\
                'content',r.content,'created_at',m.created_at,'updated_at',m.updated_at) \
             FROM agent_memories m \
             JOIN agent_memory_revisions r ON r.memory_id=m.id AND r.revision=m.current_revision \
             WHERE m.owner_user_id=$1 AND m.project_id IS NOT DISTINCT FROM $2::text \
             ORDER BY m.updated_at DESC,m.id",
        )
        .bind(owner_user_id)
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_agent_memory(
        &self,
        id: &str,
        owner_user_id: &str,
    ) -> Result<Option<Value>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT jsonb_build_object(\
                'id',m.id,'project_id',m.project_id,'title',m.title,'source_kind',m.source_kind,\
                'source_id',m.source_id,'status',m.status,'revision',m.current_revision,\
                'content',r.content,'created_at',m.created_at,'updated_at',m.updated_at) \
             FROM agent_memories m \
             JOIN agent_memory_revisions r ON r.memory_id=m.id AND r.revision=m.current_revision \
             WHERE m.id=$1 AND m.owner_user_id=$2",
        )
        .bind(id)
        .bind(owner_user_id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn list_agent_context_memories(
        &self,
        owner_user_id: &str,
        project_id: Option<&str>,
    ) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT jsonb_build_object(\
                'id',m.id,'scope',CASE WHEN m.project_id IS NULL THEN 'global' ELSE 'project' END,\
                'project_id',m.project_id,'title',m.title,'content',r.content,'revision',m.current_revision) \
             FROM agent_memories m \
             JOIN agent_memory_revisions r ON r.memory_id=m.id AND r.revision=m.current_revision \
             WHERE m.owner_user_id=$1 AND m.status='active' \
               AND (m.project_id IS NULL OR ($2::text IS NOT NULL AND m.project_id=$2)) \
             ORDER BY m.project_id NULLS FIRST,m.updated_at,m.id",
        )
        .bind(owner_user_id)
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_agent_memory(
        &self,
        id: &str,
        owner_user_id: &str,
        project_id: Option<&str>,
        title: &str,
        source_kind: &str,
        source_id: Option<&str>,
        content: &str,
    ) -> Result<Value, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO agent_memories(id,owner_user_id,project_id,title,source_kind,source_id) \
             VALUES($1,$2,$3,$4,$5,$6)",
        )
        .bind(id)
        .bind(owner_user_id)
        .bind(project_id)
        .bind(title)
        .bind(source_kind)
        .bind(source_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO agent_memory_revisions(memory_id,revision,content,change_note,created_by) \
             VALUES($1,1,$2,'Initial revision',$3)",
        )
        .bind(id)
        .bind(content)
        .bind(owner_user_id)
        .execute(&mut *tx)
        .await?;
        let value = memory_value(&mut tx, id, owner_user_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;
        tx.commit().await?;
        Ok(value)
    }

    pub async fn update_agent_memory(
        &self,
        id: &str,
        owner_user_id: &str,
        title: &str,
        status: &str,
        content: Option<&str>,
        change_note: &str,
    ) -> Result<Option<Value>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let current: Option<i32> = sqlx::query_scalar(
            "SELECT current_revision FROM agent_memories \
             WHERE id=$1 AND owner_user_id=$2 FOR UPDATE",
        )
        .bind(id)
        .bind(owner_user_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(current) = current else {
            tx.rollback().await?;
            return Ok(None);
        };
        let next = if let Some(content) = content {
            let next = current + 1;
            sqlx::query(
                "INSERT INTO agent_memory_revisions(memory_id,revision,content,change_note,created_by) \
                 VALUES($1,$2,$3,$4,$5)",
            )
            .bind(id)
            .bind(next)
            .bind(content)
            .bind(change_note)
            .bind(owner_user_id)
            .execute(&mut *tx)
            .await?;
            next
        } else {
            current
        };
        sqlx::query(
            "UPDATE agent_memories SET title=$3,status=$4,current_revision=$5,updated_at=NOW() \
             WHERE id=$1 AND owner_user_id=$2",
        )
        .bind(id)
        .bind(owner_user_id)
        .bind(title)
        .bind(status)
        .bind(next)
        .execute(&mut *tx)
        .await?;
        let value = memory_value(&mut tx, id, owner_user_id).await?;
        tx.commit().await?;
        Ok(value)
    }

    pub async fn delete_agent_memory(
        &self,
        id: &str,
        owner_user_id: &str,
    ) -> Result<bool, sqlx::Error> {
        Ok(sqlx::query(
            "UPDATE agent_memories SET status='archived',updated_at=NOW() \
             WHERE id=$1 AND owner_user_id=$2 AND status<>'archived'",
        )
        .bind(id)
        .bind(owner_user_id)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    pub async fn create_project_chat_thread(
        &self,
        id: &str,
        owner_user_id: &str,
        project_id: &str,
        title: &str,
        provider_id: Option<&str>,
    ) -> Result<Option<Value>, sqlx::Error> {
        sqlx::query_scalar(
            "INSERT INTO chat_threads(id,owner_user_id,project_id,title,provider_id) \
             SELECT $1,$2,p.id,$4,mp.id FROM projects p \
             LEFT JOIN model_providers mp ON mp.id=$5 AND mp.owner_user_id=$2 \
             WHERE p.id=$3 AND p.status='active' \
               AND EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id \
                          AND pm.user_id=$2 AND pm.role IN ('owner','editor')) \
               AND ($5::text IS NULL OR mp.id IS NOT NULL) \
             RETURNING jsonb_build_object('id',id,'title',title,'provider_id',provider_id,\
                'project_id',project_id,'status',status,'created_at',created_at,'updated_at',updated_at)",
        )
        .bind(id)
        .bind(owner_user_id)
        .bind(project_id)
        .bind(title)
        .bind(provider_id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn list_project_chat_threads(
        &self,
        owner_user_id: &str,
        project_id: &str,
    ) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT jsonb_build_object('id',t.id,'title',t.title,'provider_id',t.provider_id,\
                'project_id',t.project_id,'status',t.status,'created_at',t.created_at,'updated_at',t.updated_at) \
             FROM chat_threads t \
             WHERE t.owner_user_id=$1 AND t.project_id=$2 \
               AND EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=t.project_id AND pm.user_id=$1) \
             ORDER BY t.updated_at DESC,t.id LIMIT 200",
        )
        .bind(owner_user_id)
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn is_project_member(
        &self,
        project_id: &str,
        user_id: &str,
    ) -> Result<bool, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2)",
        )
        .bind(project_id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
    }
}

async fn skill_value(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: &str,
    owner_user_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT jsonb_build_object(\
            'id',s.id,'slug',s.slug,'name',s.name,'description',s.description,\
            'source_kind',s.source_kind,'generation_source',s.generation_source,\
            'status',s.status,'revision',s.current_revision,\
            'content',r.content,'is_builtin',FALSE,'created_at',s.created_at,'updated_at',s.updated_at) \
         FROM agent_skills s JOIN agent_skill_revisions r \
           ON r.skill_id=s.id AND r.revision=s.current_revision \
         WHERE s.id=$1 AND s.owner_user_id=$2",
    )
    .bind(id)
    .bind(owner_user_id)
    .fetch_optional(&mut **tx)
    .await
}

async fn memory_value(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: &str,
    owner_user_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT jsonb_build_object(\
            'id',m.id,'project_id',m.project_id,'title',m.title,'source_kind',m.source_kind,\
            'source_id',m.source_id,'status',m.status,'revision',m.current_revision,\
            'content',r.content,'created_at',m.created_at,'updated_at',m.updated_at) \
         FROM agent_memories m JOIN agent_memory_revisions r \
           ON r.memory_id=m.id AND r.revision=m.current_revision \
         WHERE m.id=$1 AND m.owner_user_id=$2",
    )
    .bind(id)
    .bind(owner_user_id)
    .fetch_optional(&mut **tx)
    .await
}

#[cfg(test)]
mod tests {
    use super::ResourceRepository;
    use serde_json::json;
    use shennong_schema::{ProjectUpsert, UserUpsert};
    use uuid::Uuid;

    const MIGRATION: &str = include_str!("../migrations/0015_agent_context.sql");

    #[test]
    fn migration_enforces_scopes_and_generated_drafts() {
        for required in [
            "agent_memory_project_scope_guard",
            "chat_thread_project_scope_guard",
            "chat_thread_skill_scope_guard_trigger",
            "agent_skill_revisions_immutable",
            "agent_memory_revisions_immutable",
        ] {
            assert!(MIGRATION.contains(required), "missing {required}");
        }
        assert!(MIGRATION.contains("source_kind IN ('built_in', 'user', 'generated')"));
    }

    #[tokio::test]
    #[ignore = "requires PostgreSQL in SHENNONG_TEST_DATABASE_URL; creates an isolated database"]
    async fn project_memory_isolation_and_generated_skill_draft() {
        let admin_url = std::env::var("SHENNONG_TEST_DATABASE_URL")
            .expect("SHENNONG_TEST_DATABASE_URL must point to an administrative database");
        let suffix = Uuid::new_v4().simple().to_string();
        let database_name = format!("shennong_agent_context_{suffix}");
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
        let database_url = query.map_or_else(
            || format!("{prefix}/{database_name}"),
            |query| format!("{prefix}/{database_name}?{query}"),
        );
        let repository = ResourceRepository::connect(&database_url).await.unwrap();
        repository.migrate().await.unwrap();
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
        let project_a = format!("project-a-{suffix}");
        let project_b = format!("project-b-{suffix}");
        for project_id in [&project_a, &project_b] {
            repository
                .create_project(&ProjectUpsert {
                    id: project_id.clone(),
                    name: project_id.clone(),
                    description: String::new(),
                    owner_user_id: user_id.clone(),
                    visibility: "private".into(),
                    status: "active".into(),
                    metadata: json!({}),
                })
                .await
                .unwrap();
        }
        repository
            .create_agent_memory(
                &format!("memory-a-{suffix}"),
                &user_id,
                Some(&project_a),
                "Project A only",
                "manual",
                None,
                "secret-a",
            )
            .await
            .unwrap();
        repository
            .create_agent_memory(
                &format!("memory-b-{suffix}"),
                &user_id,
                Some(&project_b),
                "Project B only",
                "manual",
                None,
                "secret-b",
            )
            .await
            .unwrap();
        let context_a = repository
            .list_agent_context_memories(&user_id, Some(&project_a))
            .await
            .unwrap();
        assert!(context_a.iter().any(|value| value["content"] == "secret-a"));
        assert!(!context_a.iter().any(|value| value["content"] == "secret-b"));

        let generated = repository
            .create_agent_skill(
                &format!("skill-{suffix}"),
                &user_id,
                &format!("generated-{suffix}"),
                "Generated",
                "Generated test skill",
                "generated",
                "pi",
                "active",
                "Summarize governed results.",
            )
            .await
            .unwrap();
        assert_eq!(generated["status"], "draft");

        repository.pool.close().await;
        sqlx::query(&format!("DROP DATABASE {database_name} WITH (FORCE)"))
            .execute(&admin_pool)
            .await
            .unwrap();
        admin_pool.close().await;
    }
}
