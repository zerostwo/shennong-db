use crate::ResourceRepository;
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct ModelProviderRecord {
    pub id: String,
    pub owner_user_id: String,
    pub name: String,
    pub provider_kind: String,
    pub base_url: String,
    pub model: String,
    pub data_policy: String,
    pub encrypted_api_key: Option<Vec<u8>>,
    pub enabled: bool,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl ModelProviderRecord {
    pub fn public_value(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "provider_kind": self.provider_kind,
            "base_url": self.base_url,
            "model": self.model,
            "data_policy": self.data_policy,
            "enabled": self.enabled,
            "is_default": self.is_default,
            "has_api_key": self.encrypted_api_key.is_some(),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        })
    }
}

impl ResourceRepository {
    #[allow(clippy::too_many_arguments)]
    pub async fn create_model_provider(
        &self,
        id: &str,
        owner_user_id: &str,
        name: &str,
        provider_kind: &str,
        base_url: &str,
        model: &str,
        data_policy: &str,
        encrypted_api_key: Option<&[u8]>,
        enabled: bool,
        is_default: bool,
    ) -> Result<ModelProviderRecord, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        if is_default {
            sqlx::query("UPDATE model_providers SET is_default=FALSE,updated_at=NOW() WHERE owner_user_id=$1")
                .bind(owner_user_id)
                .execute(&mut *tx)
                .await?;
        }
        let value = sqlx::query_as("INSERT INTO model_providers(id,owner_user_id,name,provider_kind,base_url,model,data_policy,encrypted_api_key,enabled,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,owner_user_id,name,provider_kind,base_url,model,data_policy,encrypted_api_key,enabled,is_default,created_at,updated_at")
            .bind(id).bind(owner_user_id).bind(name).bind(provider_kind).bind(base_url).bind(model)
            .bind(data_policy).bind(encrypted_api_key).bind(enabled).bind(is_default).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        Ok(value)
    }

    pub async fn list_model_providers(
        &self,
        owner_user_id: &str,
    ) -> Result<Vec<ModelProviderRecord>, sqlx::Error> {
        sqlx::query_as("SELECT id,owner_user_id,name,provider_kind,base_url,model,data_policy,encrypted_api_key,enabled,is_default,created_at,updated_at FROM model_providers WHERE owner_user_id=$1 ORDER BY is_default DESC,updated_at DESC")
            .bind(owner_user_id).fetch_all(&self.pool).await
    }

    pub async fn get_model_provider(
        &self,
        id: &str,
        owner_user_id: &str,
    ) -> Result<Option<ModelProviderRecord>, sqlx::Error> {
        sqlx::query_as("SELECT id,owner_user_id,name,provider_kind,base_url,model,data_policy,encrypted_api_key,enabled,is_default,created_at,updated_at FROM model_providers WHERE id=$1 AND owner_user_id=$2")
            .bind(id).bind(owner_user_id).fetch_optional(&self.pool).await
    }

    pub async fn default_model_provider(
        &self,
        owner_user_id: &str,
    ) -> Result<Option<ModelProviderRecord>, sqlx::Error> {
        sqlx::query_as("SELECT id,owner_user_id,name,provider_kind,base_url,model,data_policy,encrypted_api_key,enabled,is_default,created_at,updated_at FROM model_providers WHERE owner_user_id=$1 AND enabled ORDER BY is_default DESC,updated_at DESC LIMIT 1")
            .bind(owner_user_id).fetch_optional(&self.pool).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_model_provider(
        &self,
        id: &str,
        owner_user_id: &str,
        name: &str,
        provider_kind: &str,
        base_url: &str,
        model: &str,
        data_policy: &str,
        encrypted_api_key: Option<&[u8]>,
        preserve_api_key: bool,
        enabled: bool,
        is_default: bool,
    ) -> Result<Option<ModelProviderRecord>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        if is_default {
            sqlx::query("UPDATE model_providers SET is_default=FALSE,updated_at=NOW() WHERE owner_user_id=$1 AND id<>$2")
                .bind(owner_user_id).bind(id).execute(&mut *tx).await?;
        }
        let value = sqlx::query_as("UPDATE model_providers SET name=$3,provider_kind=$4,base_url=$5,model=$6,data_policy=$7,encrypted_api_key=CASE WHEN $9 THEN encrypted_api_key ELSE $8 END,enabled=$10,is_default=$11,updated_at=NOW() WHERE id=$1 AND owner_user_id=$2 RETURNING id,owner_user_id,name,provider_kind,base_url,model,data_policy,encrypted_api_key,enabled,is_default,created_at,updated_at")
            .bind(id).bind(owner_user_id).bind(name).bind(provider_kind).bind(base_url).bind(model)
            .bind(data_policy).bind(encrypted_api_key).bind(preserve_api_key).bind(enabled).bind(is_default)
            .fetch_optional(&mut *tx).await?;
        tx.commit().await?;
        Ok(value)
    }

    pub async fn delete_model_provider(
        &self,
        id: &str,
        owner_user_id: &str,
    ) -> Result<bool, sqlx::Error> {
        Ok(
            sqlx::query("DELETE FROM model_providers WHERE id=$1 AND owner_user_id=$2")
                .bind(id)
                .bind(owner_user_id)
                .execute(&self.pool)
                .await?
                .rows_affected()
                == 1,
        )
    }

    pub async fn create_chat_thread(
        &self,
        id: &str,
        owner_user_id: &str,
        title: &str,
        provider_id: Option<&str>,
    ) -> Result<Value, sqlx::Error> {
        sqlx::query_scalar("INSERT INTO chat_threads(id,owner_user_id,title,provider_id) SELECT $1,$2,$3,p.id FROM (SELECT $4::text AS requested) input LEFT JOIN model_providers p ON p.id=input.requested AND p.owner_user_id=$2 WHERE input.requested IS NULL OR p.id IS NOT NULL RETURNING jsonb_build_object('id',id,'title',title,'provider_id',provider_id,'status',status,'created_at',created_at,'updated_at',updated_at)")
            .bind(id).bind(owner_user_id).bind(title).bind(provider_id).fetch_one(&self.pool).await
    }

    pub async fn list_chat_threads(&self, owner_user_id: &str) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar("SELECT jsonb_build_object('id',id,'title',title,'provider_id',provider_id,'status',status,'created_at',created_at,'updated_at',updated_at) FROM chat_threads WHERE owner_user_id=$1 ORDER BY updated_at DESC LIMIT 200")
            .bind(owner_user_id).fetch_all(&self.pool).await
    }

    pub async fn get_chat_thread(
        &self,
        id: &str,
        owner_user_id: &str,
    ) -> Result<Option<Value>, sqlx::Error> {
        sqlx::query_scalar("SELECT jsonb_build_object('id',id,'title',title,'provider_id',provider_id,'status',status,'created_at',created_at,'updated_at',updated_at) FROM chat_threads WHERE id=$1 AND owner_user_id=$2")
            .bind(id).bind(owner_user_id).fetch_optional(&self.pool).await
    }

    pub async fn update_chat_thread(
        &self,
        id: &str,
        owner_user_id: &str,
        title: &str,
        status: &str,
        provider_id: Option<&str>,
    ) -> Result<Option<Value>, sqlx::Error> {
        sqlx::query_scalar("UPDATE chat_threads t SET title=$3,status=$4,provider_id=$5,updated_at=NOW() WHERE t.id=$1 AND t.owner_user_id=$2 AND ($5::text IS NULL OR EXISTS(SELECT 1 FROM model_providers p WHERE p.id=$5 AND p.owner_user_id=$2)) RETURNING jsonb_build_object('id',id,'title',title,'provider_id',provider_id,'status',status,'created_at',created_at,'updated_at',updated_at)")
            .bind(id).bind(owner_user_id).bind(title).bind(status).bind(provider_id).fetch_optional(&self.pool).await
    }

    pub async fn delete_chat_thread(
        &self,
        id: &str,
        owner_user_id: &str,
    ) -> Result<bool, sqlx::Error> {
        Ok(
            sqlx::query("DELETE FROM chat_threads WHERE id=$1 AND owner_user_id=$2")
                .bind(id)
                .bind(owner_user_id)
                .execute(&self.pool)
                .await?
                .rows_affected()
                == 1,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_chat_message(
        &self,
        id: &str,
        thread_id: &str,
        owner_user_id: &str,
        role: &str,
        content: &str,
        attachments: &Value,
        tool_events: &Value,
        citations: &Value,
    ) -> Result<Value, sqlx::Error> {
        sqlx::query_scalar("INSERT INTO chat_messages(id,thread_id,role,content,attachments,tool_events,citations) SELECT $1,t.id,$4,$5,$6,$7,$8 FROM chat_threads t WHERE t.id=$2 AND t.owner_user_id=$3 RETURNING jsonb_build_object('id',id,'thread_id',thread_id,'role',role,'content',content,'attachments',attachments,'tool_events',tool_events,'citations',citations,'created_at',created_at)")
            .bind(id).bind(thread_id).bind(owner_user_id).bind(role).bind(content).bind(attachments).bind(tool_events).bind(citations).fetch_one(&self.pool).await
    }

    pub async fn list_chat_messages(
        &self,
        thread_id: &str,
        owner_user_id: &str,
        limit: i64,
    ) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar("SELECT jsonb_build_object('id',recent.id,'thread_id',recent.thread_id,'role',recent.role,'content',recent.content,'attachments',recent.attachments,'tool_events',recent.tool_events,'citations',recent.citations,'created_at',recent.created_at) FROM (SELECT m.* FROM chat_messages m JOIN chat_threads t ON t.id=m.thread_id WHERE m.thread_id=$1 AND t.owner_user_id=$2 ORDER BY m.created_at DESC,m.id DESC LIMIT $3) recent ORDER BY recent.created_at,recent.id")
            .bind(thread_id).bind(owner_user_id).bind(limit.clamp(1, 500)).fetch_all(&self.pool).await
    }

    pub async fn touch_chat_thread(
        &self,
        id: &str,
        owner_user_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE chat_threads SET updated_at=NOW() WHERE id=$1 AND owner_user_id=$2")
            .bind(id)
            .bind(owner_user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn search_chat_threads(
        &self,
        owner_user_id: &str,
        query: &str,
    ) -> Result<Vec<Value>, sqlx::Error> {
        sqlx::query_scalar("SELECT jsonb_build_object('id',id,'title',title,'type','chat','updated_at',updated_at) FROM chat_threads WHERE owner_user_id=$1 AND (title ILIKE '%'||$2||'%' OR EXISTS(SELECT 1 FROM chat_messages m WHERE m.thread_id=chat_threads.id AND m.content ILIKE '%'||$2||'%')) ORDER BY updated_at DESC LIMIT 20")
            .bind(owner_user_id).bind(query).fetch_all(&self.pool).await
    }

    pub async fn get_chat_uploads(
        &self,
        owner_user_id: &str,
        upload_ids: &[String],
    ) -> Result<Vec<Value>, sqlx::Error> {
        if upload_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut uploads: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('upload_id',id,'filename',filename,'content_type',content_type,'size_bytes',size_bytes,'checksum',checksum,'status',status,'metadata',metadata) FROM uploads WHERE user_id=$1 AND id=ANY($2) AND status IN ('uploaded','registered') ORDER BY created_at,id")
            .bind(owner_user_id)
            .bind(upload_ids)
            .fetch_all(&self.pool)
            .await?;
        for upload in &mut uploads {
            let filename = upload.get("filename").and_then(Value::as_str).unwrap_or("");
            let content_type = upload
                .get("content_type")
                .and_then(Value::as_str)
                .unwrap_or("");
            upload["detected_profile"] = detect_upload_profile(filename, content_type);
        }
        Ok(uploads)
    }
}

fn detect_upload_profile(filename: &str, content_type: &str) -> Value {
    let filename = filename.to_ascii_lowercase();
    let content_type = content_type.to_ascii_lowercase();
    let (profile, modality, format) = if filename.ends_with(".h5ad") {
        ("h5ad", "single-cell", "h5ad")
    } else if filename.ends_with(".h5")
        || filename.ends_with(".hdf5")
        || content_type.contains("hdf5")
    {
        ("10x_or_hdf5", "single-cell", "hdf5")
    } else if filename.ends_with(".mtx") || filename.ends_with(".mtx.gz") {
        ("matrix_market", "single-cell", "matrix-market")
    } else if filename.ends_with(".csv") || content_type.contains("text/csv") {
        ("wet_lab_table", "wet-lab", "csv")
    } else if filename.ends_with(".tsv")
        || filename.ends_with(".tab")
        || content_type.contains("tab-separated")
    {
        ("wet_lab_table", "wet-lab", "tsv")
    } else if [".fasta", ".fa", ".fna", ".fas"]
        .iter()
        .any(|suffix| filename.ends_with(suffix))
        || content_type.contains("fasta")
    {
        ("fasta", "reference-genome", "fasta")
    } else if [".gtf", ".gff", ".gff3"]
        .iter()
        .any(|suffix| filename.ends_with(suffix))
    {
        ("genome_annotation", "reference-annotation", "gtf-gff")
    } else if filename.ends_with(".vcf") || filename.ends_with(".vcf.gz") {
        ("vcf", "genomics", "vcf")
    } else if [".fastq", ".fastq.gz", ".fq", ".fq.gz"]
        .iter()
        .any(|suffix| filename.ends_with(suffix))
    {
        ("fastq", "sequencing", "fastq")
    } else if [".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".7z"]
        .iter()
        .any(|suffix| filename.ends_with(suffix))
        || content_type.contains("zip")
        || content_type.contains("tar")
    {
        ("archive", "unknown", "archive")
    } else {
        ("generic_binary", "unknown", "binary")
    };
    json!({
        "profile": profile,
        "suggested_modality": modality,
        "suggested_format": format,
        "basis": "filename_and_content_type_only",
        "content_inspected": false
    })
}

#[cfg(test)]
mod tests {
    use super::detect_upload_profile;

    #[test]
    fn migration_defines_private_owner_scoped_agent_data() {
        let migration = include_str!("../migrations/0013_agent_chat.sql");
        assert!(migration.contains("registration_mode"));
        assert!(migration.contains("owner_user_id TEXT NOT NULL REFERENCES users(id)"));
        assert!(migration.contains("encrypted_api_key BYTEA"));
        assert!(migration.contains("data_policy IN ('public_only', 'allow_private')"));
        assert!(migration.contains("CREATE TABLE chat_threads"));
        assert!(migration.contains("CREATE TABLE chat_messages"));
    }

    #[test]
    fn upload_profiles_are_deterministic_without_reading_content() {
        let cases = [
            ("filtered_feature_bc_matrix.h5", "10x_or_hdf5"),
            ("cells.h5ad", "h5ad"),
            ("matrix.mtx.gz", "matrix_market"),
            ("assay.csv", "wet_lab_table"),
            ("assay.tsv", "wet_lab_table"),
            ("genome.fa", "fasta"),
            ("genes.gtf", "genome_annotation"),
            ("variants.vcf.gz", "vcf"),
            ("reads.fastq.gz", "fastq"),
            ("bundle.tar.gz", "archive"),
            ("object.bin", "generic_binary"),
        ];
        for (filename, expected) in cases {
            let profile = detect_upload_profile(filename, "application/octet-stream");
            assert_eq!(profile["profile"], expected, "{filename}");
            assert_eq!(profile["content_inspected"], false);
        }
    }
}
