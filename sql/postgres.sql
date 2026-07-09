CREATE TABLE IF NOT EXISTS dataset_versions (
    dataset_id text NOT NULL,
    version text NOT NULL,
    type text NOT NULL,
    backend text NOT NULL,
    citation text,
    storage_uri text,
    status text NOT NULL DEFAULT 'active',
    is_default boolean NOT NULL DEFAULT false,
    schema_version text NOT NULL DEFAULT '1.0',
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_dataset_versions_dataset_version UNIQUE (dataset_id, version)
);

CREATE INDEX IF NOT EXISTS ix_dataset_versions_dataset_id
    ON dataset_versions (dataset_id);

CREATE INDEX IF NOT EXISTS ix_dataset_versions_type_status
    ON dataset_versions (type, status);

CREATE TABLE IF NOT EXISTS users (
    user_id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    display_name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    is_superuser boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
    org_id text PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    created_by text REFERENCES users(user_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    project_id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(org_id),
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    visibility text NOT NULL DEFAULT 'private',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_projects_org_slug UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS memberships (
    membership_id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(org_id),
    user_id text NOT NULL REFERENCES users(user_id),
    role text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_memberships_org_user UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS api_tokens (
    token_id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(user_id),
    name text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
    expires_at timestamptz,
    revoked_at timestamptz,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
    event_id text PRIMARY KEY,
    actor_user_id text REFERENCES users(user_id),
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE INDEX IF NOT EXISTS ix_organizations_slug ON organizations (slug);
CREATE INDEX IF NOT EXISTS ix_projects_org_id ON projects (org_id);
CREATE INDEX IF NOT EXISTS ix_memberships_user_id ON memberships (user_id);
CREATE INDEX IF NOT EXISTS ix_api_tokens_user_id ON api_tokens (user_id);
CREATE INDEX IF NOT EXISTS ix_audit_events_resource ON audit_events (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS ix_audit_events_created_at ON audit_events (created_at);
