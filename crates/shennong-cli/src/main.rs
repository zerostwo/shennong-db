use clap::{Parser, Subcommand};
use shennong_auth::{Role, issue_token};
use shennong_core::{ProviderInstaller, ResourceRepository};
use shennong_schema::{ArtifactUpsert, RelationUpsert, ResourceUpsert};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Migrate {
        #[arg(long, env = "SHENNONG_DATABASE_URL")]
        database_url: String,
    },
    Token {
        #[arg(long, env = "SHENNONG_JWT_SECRET")]
        jwt_secret: String,
        #[arg(long)]
        user_id: String,
        #[arg(long, default_value = "user")]
        role: String,
        #[arg(long, default_value_t = 86_400)]
        expires_in: u64,
    },
    Import {
        #[arg(long, env = "SHENNONG_DATABASE_URL")]
        database_url: String,
        bundle: std::path::PathBuf,
    },
    Providers {
        #[arg(long, env = "SHENNONG_PROVIDER_DIR", default_value = "providers")]
        provider_dir: std::path::PathBuf,
    },
}

#[derive(serde::Deserialize)]
struct ImportBundle {
    resources: Vec<ResourceUpsert>,
    artifacts: Vec<ArtifactUpsert>,
    #[serde(default)]
    relations: Vec<RelationUpsert>,
    #[serde(default)]
    grants: Vec<ResourceGrant>,
}

#[derive(serde::Deserialize)]
struct ResourceGrant {
    resource_id: String,
    user_id: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    match Cli::parse().command {
        Command::Migrate { database_url } => {
            ResourceRepository::connect(&database_url)
                .await?
                .migrate()
                .await?
        }
        Command::Token {
            jwt_secret,
            user_id,
            role,
            expires_in,
        } => {
            let role = match role.as_str() {
                "admin" => Role::Admin,
                "user" => Role::User,
                "guest" => Role::Guest,
                _ => return Err("role must be guest, user, or admin".into()),
            };
            let expires_at = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() + expires_in;
            println!(
                "{}",
                issue_token(
                    &jwt_secret,
                    user_id,
                    role,
                    expires_at as usize,
                    vec!["resource.read".into()]
                )?
            );
        }
        Command::Import {
            database_url,
            bundle,
        } => {
            let repository = ResourceRepository::connect(&database_url).await?;
            repository.migrate().await?;
            let input: ImportBundle = serde_json::from_slice(&std::fs::read(bundle)?)?;
            for resource in &input.resources {
                repository.upsert_resource(resource).await?;
            }
            for artifact in &input.artifacts {
                repository.upsert_artifact(artifact).await?;
            }
            for relation in &input.relations {
                repository.upsert_relation(relation).await?;
            }
            for grant in &input.grants {
                repository
                    .grant_resource(&grant.resource_id, &grant.user_id)
                    .await?;
            }
            println!(
                "imported {} resources, {} artifacts, {} relations, {} grants",
                input.resources.len(),
                input.artifacts.len(),
                input.relations.len(),
                input.grants.len()
            );
        }
        Command::Providers { provider_dir } => {
            for provider in ProviderInstaller::new(provider_dir, std::env::temp_dir(), 1)
                .list()
                .await?
            {
                println!("{}@{}", provider.name, provider.version);
            }
        }
    }
    Ok(())
}
