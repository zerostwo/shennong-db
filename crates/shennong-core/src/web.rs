use super::{ResourceRepository, upsert_artifact_transaction, upsert_resource_transaction};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use shennong_schema::{ArtifactUpsert, RelationUpsert, ResourceUpsert};
use sqlx::Row;

pub struct UploadWrite<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub filename: &'a str,
    pub content_type: &'a str,
    pub size: i64,
    pub checksum: &'a str,
    pub storage_uri: &'a str,
    pub metadata: &'a Value,
}
pub struct LoginEventWrite<'a> {
    pub id: &'a str,
    pub user_id: Option<&'a str>,
    pub email: &'a str,
    pub success: bool,
    pub ip: Option<&'a str>,
    pub user_agent: Option<&'a str>,
    pub reason: Option<&'a str>,
}
pub struct UsageEventWrite<'a> {
    pub user_id: Option<&'a str>,
    pub token_hash: Option<&'a str>,
    pub method: &'a str,
    pub path: &'a str,
    pub resource_id: Option<&'a str>,
    pub status: u16,
    pub response_bytes: i64,
    pub duration_ms: f64,
    pub rate_limited: bool,
}

impl ResourceRepository {
    pub async fn list_ingestion_jobs(&self) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT jsonb_build_object('id', id, 'provider_name', provider_name, 'provider_version', provider_version, 'resource_id', resource_id, 'status', status, 'error_code', error_code, 'created_at', created_at, 'updated_at', updated_at) FROM ingestion_jobs ORDER BY updated_at DESC",
        )
        .fetch_all(&self.pool)
        .await
    }

    pub async fn list_grants(&self) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT jsonb_build_object('resource_id', g.resource_id, 'user_id', g.user_id, 'user_name', COALESCE(u.display_name, g.user_id), 'user_email', u.email, 'scopes', g.scopes, 'granted_by', g.granted_by, 'reason', g.reason, 'granted_at', g.granted_at, 'expires_at', g.expires_at) FROM resource_grants g LEFT JOIN users u ON u.id = g.user_id ORDER BY g.granted_at DESC",
        )
        .fetch_all(&self.pool)
        .await
    }

    pub async fn upsert_grant_details(
        &self,
        resource_id: &str,
        user_id: &str,
        scopes: &Value,
        granted_by: Option<&str>,
        reason: Option<&str>,
        expires_at: Option<DateTime<Utc>>,
    ) -> Result<Value, sqlx::Error> {
        sqlx::query_scalar(
            "INSERT INTO resource_grants (resource_id, user_id, scopes, granted_by, reason, expires_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (resource_id,user_id) DO UPDATE SET scopes=EXCLUDED.scopes, granted_by=EXCLUDED.granted_by, reason=EXCLUDED.reason, expires_at=EXCLUDED.expires_at, granted_at=NOW() RETURNING jsonb_build_object('resource_id',resource_id,'user_id',user_id,'scopes',scopes,'granted_by',granted_by,'reason',reason,'granted_at',granted_at,'expires_at',expires_at)",
        )
        .bind(resource_id)
        .bind(user_id)
        .bind(scopes)
        .bind(granted_by)
        .bind(reason)
        .bind(expires_at)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn delete_grant(
        &self,
        resource_id: &str,
        user_id: &str,
    ) -> Result<bool, sqlx::Error> {
        Ok(
            sqlx::query("DELETE FROM resource_grants WHERE resource_id=$1 AND user_id=$2")
                .bind(resource_id)
                .bind(user_id)
                .execute(&self.pool)
                .await?
                .rows_affected()
                == 1,
        )
    }

    pub async fn list_all_access_tokens(&self) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT jsonb_build_object('token_id', t.token_hash, 'user_id', t.user_id, 'owner', u.display_name, 'scopes', t.scopes, 'issued_at', t.issued_at, 'expires_at', t.expires_at, 'revoked_at', t.revoked_at) FROM access_tokens t JOIN users u ON u.id=t.user_id WHERE NOT EXISTS (SELECT 1 FROM auth_sessions s WHERE s.token_hash=t.token_hash) ORDER BY t.issued_at DESC",
        ).fetch_all(&self.pool).await
    }

    pub async fn list_collections(
        &self,
        user_id: Option<&str>,
        admin: bool,
    ) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT jsonb_build_object('id',c.id,'name',c.name,'description',c.description,'owner_user_id',c.owner_user_id,'owner_name',u.display_name,'visibility',c.visibility,'resource_count',COUNT(cr.resource_id),'created_at',c.created_at,'updated_at',c.updated_at) FROM collections c JOIN users u ON u.id=c.owner_user_id LEFT JOIN collection_resources cr ON cr.collection_id=c.id WHERE c.visibility='public' OR c.owner_user_id=$1 OR $2 GROUP BY c.id,u.display_name ORDER BY c.updated_at DESC",
        ).bind(user_id).bind(admin).fetch_all(&self.pool).await
    }

    pub async fn create_collection(
        &self,
        id: &str,
        name: &str,
        description: &str,
        owner: &str,
        visibility: &str,
    ) -> Result<Value, sqlx::Error> {
        sqlx::query_scalar("INSERT INTO collections(id,name,description,owner_user_id,visibility) VALUES($1,$2,$3,$4,$5) RETURNING jsonb_build_object('id',id,'name',name,'description',description,'owner_user_id',owner_user_id,'visibility',visibility,'resource_count',0,'created_at',created_at,'updated_at',updated_at)")
            .bind(id).bind(name).bind(description).bind(owner).bind(visibility).fetch_one(&self.pool).await
    }

    pub async fn delete_collection(
        &self,
        id: &str,
        user_id: &str,
        admin: bool,
    ) -> Result<bool, sqlx::Error> {
        Ok(
            sqlx::query("DELETE FROM collections WHERE id=$1 AND (owner_user_id=$2 OR $3)")
                .bind(id)
                .bind(user_id)
                .bind(admin)
                .execute(&self.pool)
                .await?
                .rows_affected()
                == 1,
        )
    }

    pub async fn set_collection_resource(
        &self,
        collection_id: &str,
        resource_id: &str,
        add: bool,
    ) -> Result<bool, sqlx::Error> {
        let result = if add {
            sqlx::query("INSERT INTO collection_resources(collection_id,resource_id) VALUES($1,$2) ON CONFLICT DO NOTHING").bind(collection_id).bind(resource_id).execute(&self.pool).await?
        } else {
            sqlx::query(
                "DELETE FROM collection_resources WHERE collection_id=$1 AND resource_id=$2",
            )
            .bind(collection_id)
            .bind(resource_id)
            .execute(&self.pool)
            .await?
        };
        Ok(result.rows_affected() == 1)
    }

    pub async fn list_favorites(&self, user_id: &str) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar("SELECT jsonb_build_object('resource_id',f.resource_id,'created_at',f.created_at,'resource',to_jsonb(r)) FROM favorites f JOIN resources r ON r.id=f.resource_id WHERE f.user_id=$1 ORDER BY f.created_at DESC")
            .bind(user_id).fetch_all(&self.pool).await
    }

    pub async fn get_profile(&self, user_id: &str) -> Result<Option<Value>, sqlx::Error> {
        sqlx::query_scalar("SELECT jsonb_build_object('id',u.id,'display_name',u.display_name,'email',u.email,'role',u.role,'status',u.status,'locale',COALESCE(p.locale,'en'),'timezone',COALESCE(p.timezone,'UTC'),'avatar_uri',p.avatar_uri,'created_at',u.created_at,'updated_at',GREATEST(u.updated_at,COALESCE(p.updated_at,u.updated_at))) FROM users u LEFT JOIN user_preferences p ON p.user_id=u.id WHERE u.id=$1").bind(user_id).fetch_optional(&self.pool).await
    }

    pub async fn update_profile(
        &self,
        user_id: &str,
        display_name: &str,
        email: Option<&str>,
        locale: &str,
        timezone: &str,
    ) -> Result<Value, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE users SET display_name=$2,email=$3,updated_at=NOW() WHERE id=$1")
            .bind(user_id)
            .bind(display_name)
            .bind(email)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO user_preferences(user_id,locale,timezone) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET locale=EXCLUDED.locale,timezone=EXCLUDED.timezone,updated_at=NOW()").bind(user_id).bind(locale).bind(timezone).execute(&mut *tx).await?;
        tx.commit().await?;
        self.get_profile(user_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    pub async fn set_favorite(
        &self,
        user_id: &str,
        resource_id: &str,
        favorite: bool,
    ) -> Result<bool, sqlx::Error> {
        let result = if favorite {
            sqlx::query(
                "INSERT INTO favorites(user_id,resource_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            )
            .bind(user_id)
            .bind(resource_id)
            .execute(&self.pool)
            .await?
        } else {
            sqlx::query("DELETE FROM favorites WHERE user_id=$1 AND resource_id=$2")
                .bind(user_id)
                .bind(resource_id)
                .execute(&self.pool)
                .await?
        };
        Ok(result.rows_affected() == 1)
    }

    pub async fn create_upload(&self, value: &UploadWrite<'_>) -> Result<Value, sqlx::Error> {
        sqlx::query_scalar("INSERT INTO uploads(id,user_id,filename,content_type,size_bytes,checksum,storage_uri,metadata,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'uploaded') RETURNING jsonb_build_object('id',id,'user_id',user_id,'filename',filename,'content_type',content_type,'size_bytes',size_bytes,'checksum',checksum,'storage_uri',storage_uri,'status',status,'metadata',metadata,'created_at',created_at,'updated_at',updated_at)")
            .bind(value.id).bind(value.user_id).bind(value.filename).bind(value.content_type).bind(value.size).bind(value.checksum).bind(value.storage_uri).bind(value.metadata).fetch_one(&self.pool).await
    }

    pub async fn list_uploads(
        &self,
        user_id: Option<&str>,
        admin: bool,
    ) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar("SELECT jsonb_build_object('id',x.id,'user_id',x.user_id,'owner',u.display_name,'filename',x.filename,'content_type',x.content_type,'size_bytes',x.size_bytes,'checksum',x.checksum,'storage_uri',x.storage_uri,'status',x.status,'error_code',x.error_code,'metadata',x.metadata,'created_at',x.created_at,'updated_at',x.updated_at) FROM uploads x JOIN users u ON u.id=x.user_id WHERE x.user_id=$1 OR $2 ORDER BY x.created_at DESC")
            .bind(user_id).bind(admin).fetch_all(&self.pool).await
    }

    pub async fn register_upload_resource(
        &self,
        resource: &ResourceUpsert,
        upload_ids: &[String],
        user_id: &str,
        format: &str,
        data_class: &str,
    ) -> Result<Value, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let uploads=sqlx::query("SELECT id,filename,size_bytes,checksum,storage_uri,content_type FROM uploads WHERE id=ANY($1) AND user_id=$2 AND status='uploaded' FOR UPDATE").bind(upload_ids).bind(user_id).fetch_all(&mut *tx).await?;
        if uploads.len() != upload_ids.len() {
            return Err(sqlx::Error::RowNotFound);
        }
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(&resource.id)
            .execute(&mut *tx)
            .await?;
        let resource_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM resources WHERE id=$1)")
                .bind(&resource.id)
                .fetch_one(&mut *tx)
                .await?;
        if resource_exists {
            return Err(sqlx::Error::Protocol(
                "upload resource already exists".into(),
            ));
        }
        let stored = upsert_resource_transaction(&mut tx, resource).await?;
        sqlx::query("INSERT INTO resource_grants(resource_id,user_id,scopes,granted_by,reason) VALUES($1,$2,'[\"resource.read\"]'::jsonb,$2,'upload owner') ON CONFLICT(resource_id,user_id) DO UPDATE SET scopes=EXCLUDED.scopes,granted_by=EXCLUDED.granted_by,reason=EXCLUDED.reason,expires_at=NULL")
            .bind(&resource.id).bind(user_id).execute(&mut *tx).await?;
        for row in uploads {
            let id: String = row.get("id");
            let filename: String = row.get("filename");
            let uri: String = row.get("storage_uri");
            let checksum: String = row.get("checksum");
            let size: i64 = row.get("size_bytes");
            let content_type: String = row.get("content_type");
            let artifact = ArtifactUpsert {
                id: format!("upload-{id}"),
                resource_id: resource.id.clone(),
                uri: uri.clone(),
                format: format.into(),
                size: Some(size),
                checksum: Some(checksum.clone()),
                storage_backend: if uri.starts_with("s3://") {
                    "s3".into()
                } else {
                    "local".into()
                },
                data_class: data_class.into(),
                immutable: true,
                content_sha256: Some(checksum),
                source_uri: Some(format!("upload://{id}/{filename}")),
                derived_from: json!([]),
                pipeline_version: Some("web-upload-v1".into()),
                retention_policy: Some("retain".into()),
                storage_uri: Some(uri),
                schema_json: json!({"filename":filename,"content_type":content_type,"role":"upload"}),
                provenance: json!({"uploaded_by":user_id,"integrity_status":"verified"}),
            };
            upsert_artifact_transaction(&mut tx, &artifact).await?;
        }
        sqlx::query("UPDATE uploads SET status='registered',metadata=metadata||jsonb_build_object('resource_id',$2),updated_at=NOW() WHERE id=ANY($1)").bind(upload_ids).bind(&resource.id).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(serde_json::to_value(stored).unwrap_or_default())
    }

    pub async fn get_settings(&self) -> Result<Value, sqlx::Error> {
        let rows =
            sqlx::query("SELECT key,value,updated_by,updated_at FROM system_settings ORDER BY key")
                .fetch_all(&self.pool)
                .await?;
        let mut result = serde_json::Map::new();
        for row in rows {
            result.insert(row.get::<String,_>("key"), json!({"value":row.get::<Value,_>("value"),"updated_by":row.get::<Option<String>,_>("updated_by"),"updated_at":row.get::<DateTime<Utc>,_>("updated_at")}));
        }
        Ok(Value::Object(result))
    }

    pub async fn setting_value(&self, key: &str) -> Result<Option<Value>, sqlx::Error> {
        sqlx::query_scalar("SELECT value FROM system_settings WHERE key=$1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn set_setting(
        &self,
        key: &str,
        value: &Value,
        user_id: Option<&str>,
    ) -> Result<Value, sqlx::Error> {
        sqlx::query_scalar("INSERT INTO system_settings(key,value,updated_by) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING jsonb_build_object('key',key,'value',value,'updated_by',updated_by,'updated_at',updated_at)")
            .bind(key).bind(value).bind(user_id).fetch_one(&self.pool).await
    }

    pub async fn apply_retention(
        &self,
        audit_days: i32,
        usage_days: i32,
        login_days: i32,
    ) -> Result<Value, sqlx::Error> {
        let audit =
            sqlx::query("DELETE FROM audit_events WHERE created_at<NOW()-make_interval(days=>$1)")
                .bind(audit_days)
                .execute(&self.pool)
                .await?
                .rows_affected();
        let usage =
            sqlx::query("DELETE FROM usage_events WHERE created_at<NOW()-make_interval(days=>$1)")
                .bind(usage_days)
                .execute(&self.pool)
                .await?
                .rows_affected();
        let login =
            sqlx::query("DELETE FROM login_events WHERE created_at<NOW()-make_interval(days=>$1)")
                .bind(login_days)
                .execute(&self.pool)
                .await?
                .rows_affected();
        Ok(json!({"audit_deleted":audit,"usage_deleted":usage,"login_deleted":login}))
    }

    pub async fn create_backup_job(
        &self,
        id: &str,
        user_id: Option<&str>,
        kind: &str,
    ) -> Result<Value, sqlx::Error> {
        sqlx::query_scalar("INSERT INTO backup_jobs(id,created_by,kind,status) VALUES($1,$2,$3,'running') RETURNING jsonb_build_object('id',id,'created_by',created_by,'kind',kind,'status',status,'created_at',created_at)")
            .bind(id).bind(user_id).bind(kind).fetch_one(&self.pool).await
    }

    pub async fn complete_backup_job(
        &self,
        id: &str,
        uri: &str,
        size: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE backup_jobs SET status='completed',storage_uri=$2,size_bytes=$3,completed_at=NOW() WHERE id=$1").bind(id).bind(uri).bind(size).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn fail_backup_job(&self, id: &str, code: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE backup_jobs SET status='failed',error_code=$2,completed_at=NOW() WHERE id=$1",
        )
        .bind(id)
        .bind(code)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_backup_jobs(&self) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar("SELECT jsonb_build_object('id',id,'created_by',created_by,'kind',kind,'status',status,'storage_uri',storage_uri,'size_bytes',size_bytes,'error_code',error_code,'created_at',created_at,'completed_at',completed_at) FROM backup_jobs ORDER BY created_at DESC").fetch_all(&self.pool).await
    }

    pub async fn get_backup_job(&self, id: &str) -> Result<Option<Value>, sqlx::Error> {
        sqlx::query_scalar("SELECT jsonb_build_object('id',id,'created_by',created_by,'kind',kind,'status',status,'storage_uri',storage_uri,'size_bytes',size_bytes,'error_code',error_code,'created_at',created_at,'completed_at',completed_at) FROM backup_jobs WHERE id=$1").bind(id).fetch_optional(&self.pool).await
    }

    pub async fn metadata_snapshot(&self) -> Result<Value, sqlx::Error> {
        let resources: Value = sqlx::query_scalar(
            "SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM resources r",
        )
        .fetch_one(&self.pool)
        .await?;
        let artifacts: Value = sqlx::query_scalar("SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'resource_id',resource_id,'uri',uri,'format',format,'size',size,'checksum',checksum,'storage_backend',storage_backend,'data_class',data_class,'immutable',immutable,'content_sha256',content_sha256,'source_uri',source_uri,'derived_from',derived_from,'pipeline_version',pipeline_version,'retention_policy',retention_policy,'storage_uri',storage_uri,'schema',schema_json,'provenance',provenance)), '[]'::jsonb) FROM artifacts").fetch_one(&self.pool).await?;
        let relations: Value = sqlx::query_scalar(
            "SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM relations x",
        )
        .fetch_one(&self.pool)
        .await?;
        let users: Value = sqlx::query_scalar("SELECT COALESCE(jsonb_agg(to_jsonb(u) - 'password_hash' - 'totp_secret'), '[]'::jsonb) FROM users u").fetch_one(&self.pool).await?;
        Ok(
            json!({"schema_version":1,"created_at":Utc::now(),"resources":resources,"artifacts":artifacts,"relations":relations,"users":users}),
        )
    }

    pub async fn backup_uri(&self, id: &str) -> Result<Option<String>, sqlx::Error> {
        let uri: Option<String> = sqlx::query_scalar(
            "SELECT storage_uri FROM backup_jobs WHERE id=$1 AND status='completed'",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .flatten();
        Ok(uri)
    }

    pub async fn restore_metadata_snapshot(&self, value: &Value) -> Result<(), sqlx::Error> {
        if value.get("schema_version").and_then(Value::as_i64) != Some(1) {
            return Err(sqlx::Error::Protocol("unsupported backup schema".into()));
        }
        let resources: Vec<ResourceUpsert> =
            serde_json::from_value(value.get("resources").cloned().unwrap_or_else(|| json!([])))
                .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
        let artifacts: Vec<ArtifactUpsert> =
            serde_json::from_value(value.get("artifacts").cloned().unwrap_or_else(|| json!([])))
                .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
        let relations: Vec<RelationUpsert> =
            serde_json::from_value(value.get("relations").cloned().unwrap_or_else(|| json!([])))
                .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
        let mut tx = self.pool.begin().await?;
        for resource in &resources {
            upsert_resource_transaction(&mut tx, resource).await?;
        }
        for artifact in &artifacts {
            upsert_artifact_transaction(&mut tx, artifact).await?;
        }
        for relation in &relations {
            sqlx::query("INSERT INTO relations(source,target,relation_type,evidence,provenance) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source,target,relation_type) DO UPDATE SET evidence=EXCLUDED.evidence,provenance=EXCLUDED.provenance").bind(&relation.source).bind(&relation.target).bind(&relation.relation_type).bind(&relation.evidence).bind(&relation.provenance).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn record_login_event(&self, value: &LoginEventWrite<'_>) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO login_events(id,user_id,email,success,ip_address,user_agent,failure_reason) VALUES($1::uuid,$2,$3,$4,$5,$6,$7)").bind(value.id).bind(value.user_id).bind(value.email).bind(value.success).bind(value.ip).bind(value.user_agent).bind(value.reason).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn list_login_events(&self, user_id: &str) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar("SELECT jsonb_build_object('id',id,'email',email,'success',success,'ip_address',ip_address,'user_agent',user_agent,'failure_reason',failure_reason,'created_at',created_at) FROM login_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200").bind(user_id).fetch_all(&self.pool).await
    }

    pub async fn create_auth_session(
        &self,
        token_hash: &str,
        user_id: &str,
        expires_at: DateTime<Utc>,
        ip: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO auth_sessions(token_hash,user_id,expires_at,ip_address,user_agent) VALUES($1,$2,$3,$4,$5) ON CONFLICT(token_hash) DO UPDATE SET last_seen_at=NOW(),ip_address=EXCLUDED.ip_address,user_agent=EXCLUDED.user_agent").bind(token_hash).bind(user_id).bind(expires_at).bind(ip).bind(user_agent).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn touch_auth_session(&self, token_hash: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE auth_sessions SET last_seen_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL").bind(token_hash).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn revoke_auth_session(
        &self,
        token_hash: &str,
        user_id: &str,
    ) -> Result<bool, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let changed=sqlx::query("UPDATE auth_sessions SET revoked_at=NOW() WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL").bind(token_hash).bind(user_id).execute(&mut *tx).await?.rows_affected()==1;
        if changed {
            sqlx::query("UPDATE access_tokens SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL").bind(token_hash).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(changed)
    }

    pub async fn list_auth_sessions(&self, user_id: &str) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar("SELECT jsonb_build_object('token_id',token_hash,'ip_address',ip_address,'user_agent',user_agent,'created_at',created_at,'last_seen_at',last_seen_at,'expires_at',expires_at,'revoked_at',revoked_at) FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>NOW() ORDER BY last_seen_at DESC").bind(user_id).fetch_all(&self.pool).await
    }

    pub async fn set_totp_secret(
        &self,
        user_id: &str,
        secret: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE users SET totp_secret=$2,updated_at=NOW() WHERE id=$1")
            .bind(user_id)
            .bind(secret)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn replace_recovery_codes(
        &self,
        user_id: &str,
        hashes: &[String],
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM recovery_codes WHERE user_id=$1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        for hash in hashes {
            sqlx::query("INSERT INTO recovery_codes(user_id,code_hash) VALUES($1,$2)")
                .bind(user_id)
                .bind(hash)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn update_password(
        &self,
        user_id: &str,
        password_hash: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE users SET password_hash=$2,updated_at=NOW() WHERE id=$1")
            .bind(user_id)
            .bind(password_hash)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_password_reset(
        &self,
        token_hash: &str,
        user_id: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM password_reset_tokens WHERE user_id=$1 AND used_at IS NULL")
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "INSERT INTO password_reset_tokens(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
        )
        .bind(token_hash)
        .bind(user_id)
        .bind(expires_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn consume_password_reset(
        &self,
        token_hash: &str,
        password_hash: &str,
    ) -> Result<bool, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let user_id: Option<String>=sqlx::query_scalar("UPDATE password_reset_tokens SET used_at=NOW() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() RETURNING user_id").bind(token_hash).fetch_optional(&mut *tx).await?;
        let Some(user_id) = user_id else {
            tx.rollback().await?;
            return Ok(false);
        };
        sqlx::query("UPDATE users SET password_hash=$2,updated_at=NOW() WHERE id=$1")
            .bind(&user_id)
            .bind(password_hash)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "UPDATE access_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL",
        )
        .bind(&user_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL",
        )
        .bind(&user_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    pub async fn create_totp_enrollment(
        &self,
        user_id: &str,
        secret: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO totp_enrollments(user_id,secret,expires_at) VALUES($1,$2,NOW()+INTERVAL '10 minutes') ON CONFLICT(user_id) DO UPDATE SET secret=EXCLUDED.secret,expires_at=EXCLUDED.expires_at,created_at=NOW()").bind(user_id).bind(secret).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn get_totp_enrollment(&self, user_id: &str) -> Result<Option<String>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT secret FROM totp_enrollments WHERE user_id=$1 AND expires_at>NOW()",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn complete_totp_enrollment(
        &self,
        user_id: &str,
        secret: &str,
        recovery_hashes: &[String],
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE users SET totp_secret=$2,updated_at=NOW() WHERE id=$1")
            .bind(user_id)
            .bind(secret)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM recovery_codes WHERE user_id=$1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        for hash in recovery_hashes {
            sqlx::query("INSERT INTO recovery_codes(user_id,code_hash) VALUES($1,$2)")
                .bind(user_id)
                .bind(hash)
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query("DELETE FROM totp_enrollments WHERE user_id=$1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn consume_recovery_code(
        &self,
        user_id: &str,
        code_hash: &str,
    ) -> Result<bool, sqlx::Error> {
        Ok(sqlx::query("UPDATE recovery_codes SET used_at=NOW() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL").bind(user_id).bind(code_hash).execute(&self.pool).await?.rows_affected()==1)
    }

    pub async fn recovery_code_count(&self, user_id: &str) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM recovery_codes WHERE user_id=$1 AND used_at IS NULL",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn record_usage(&self, value: &UsageEventWrite<'_>) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO usage_events(user_id,token_hash,method,path,resource_id,status_code,response_bytes,duration_ms,rate_limited) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(value.user_id).bind(value.token_hash).bind(value.method).bind(value.path).bind(value.resource_id).bind(i32::from(value.status)).bind(value.response_bytes).bind(value.duration_ms).bind(value.rate_limited).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn usage_summary(
        &self,
        user_id: Option<&str>,
        admin: bool,
        days: i64,
    ) -> Result<Value, sqlx::Error> {
        let totals: Value=sqlx::query_scalar("SELECT jsonb_build_object('requests',COUNT(*),'response_bytes',COALESCE(SUM(response_bytes),0),'errors',COUNT(*) FILTER (WHERE status_code>=400),'rate_limited',COUNT(*) FILTER (WHERE rate_limited),'median_latency_ms',COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms),0)) FROM usage_events WHERE created_at>=NOW()-make_interval(days=>$3::int) AND (user_id=$1 OR $2)").bind(user_id).bind(admin).bind(days as i32).fetch_one(&self.pool).await?;
        let series: Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('date',date_trunc('day',created_at),'requests',COUNT(*),'errors',COUNT(*) FILTER(WHERE status_code>=400),'response_bytes',COALESCE(SUM(response_bytes),0)) FROM usage_events WHERE created_at>=NOW()-make_interval(days=>$3::int) AND (user_id=$1 OR $2) GROUP BY date_trunc('day',created_at) ORDER BY date_trunc('day',created_at)").bind(user_id).bind(admin).bind(days as i32).fetch_all(&self.pool).await?;
        let endpoints: Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('endpoint',method||' '||path,'requests',COUNT(*),'errors',COUNT(*) FILTER(WHERE status_code>=400),'median_latency_ms',percentile_cont(0.5) WITHIN GROUP(ORDER BY duration_ms)) FROM usage_events WHERE created_at>=NOW()-make_interval(days=>$3::int) AND (user_id=$1 OR $2) GROUP BY method,path ORDER BY COUNT(*) DESC LIMIT 20").bind(user_id).bind(admin).bind(days as i32).fetch_all(&self.pool).await?;
        let resources: Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('resource_id',COALESCE(resource_id,'unscoped'),'requests',COUNT(*),'response_bytes',COALESCE(SUM(response_bytes),0),'errors',COUNT(*) FILTER(WHERE status_code>=400)) FROM usage_events WHERE created_at>=NOW()-make_interval(days=>$3::int) AND (user_id=$1 OR $2) GROUP BY resource_id ORDER BY COUNT(*) DESC LIMIT 20").bind(user_id).bind(admin).bind(days as i32).fetch_all(&self.pool).await?;
        Ok(
            json!({"days":days,"totals":totals,"series":series,"endpoints":endpoints,"resources":resources}),
        )
    }

    pub async fn admin_overview(&self) -> Result<Value, sqlx::Error> {
        sqlx::query_scalar("SELECT jsonb_build_object('users',(SELECT COUNT(*) FROM users),'active_users',(SELECT COUNT(*) FROM users WHERE status='active'),'resources',(SELECT COUNT(*) FROM resources),'artifacts',(SELECT COUNT(*) FROM artifacts),'logical_bytes',(SELECT COALESCE(SUM(size),0) FROM artifacts),'active_jobs',(SELECT COUNT(*) FROM ingestion_jobs WHERE status IN ('registered','downloading','verifying','materializing')),'failed_jobs',(SELECT COUNT(*) FROM ingestion_jobs WHERE status='failed'),'collections',(SELECT COUNT(*) FROM collections),'uploads',(SELECT COUNT(*) FROM uploads),'last_audit_at',(SELECT MAX(created_at) FROM audit_events))").fetch_one(&self.pool).await
    }

    pub async fn storage_summary(&self) -> Result<Value, sqlx::Error> {
        let totals: Value=sqlx::query_scalar("SELECT jsonb_build_object('artifact_count',COUNT(*),'logical_bytes',COALESCE(SUM(size),0),'verified',COUNT(*) FILTER(WHERE provenance->>'integrity_status'='verified')) FROM artifacts").fetch_one(&self.pool).await?;
        let backends: Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('backend',storage_backend,'artifact_count',COUNT(*),'logical_bytes',COALESCE(SUM(size),0),'last_write_at',MAX(created_at)) FROM artifacts GROUP BY storage_backend ORDER BY storage_backend").fetch_all(&self.pool).await?;
        Ok(json!({"totals":totals,"backends":backends}))
    }
}
