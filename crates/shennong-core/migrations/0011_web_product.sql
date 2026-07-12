ALTER TABLE resource_grants
  ADD COLUMN IF NOT EXISTS scopes JSONB NOT NULL DEFAULT '["resource.read"]'::jsonb,
  ADD COLUMN IF NOT EXISTS granted_by TEXT,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE collection_resources (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_id, resource_id)
);

CREATE TABLE favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, resource_id)
);

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  locale TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  avatar_uri TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  checksum TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploading', 'uploaded', 'registered', 'failed', 'deleted')),
  error_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_uploads_user_created ON uploads(user_id, created_at DESC);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE backup_jobs (
  id TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'metadata' CHECK (kind IN ('metadata', 'full')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'restoring', 'restored')),
  storage_uri TEXT,
  size_bytes BIGINT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE login_events (
  id UUID PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_login_events_user_created ON login_events(user_id, created_at DESC);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY REFERENCES access_tokens(token_hash) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX ix_auth_sessions_user_active ON auth_sessions(user_id, expires_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE recovery_codes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE totp_enrollments (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE usage_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  token_hash TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  resource_id TEXT,
  status_code INTEGER NOT NULL,
  response_bytes BIGINT NOT NULL DEFAULT 0,
  duration_ms DOUBLE PRECISION NOT NULL,
  rate_limited BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_usage_events_user_created ON usage_events(user_id, created_at DESC);
CREATE INDEX ix_usage_events_created ON usage_events(created_at DESC);

INSERT INTO system_settings (key, value) VALUES
  ('general', '{"instance_name":"ShennongDB","support_email":"","public_catalog":true}'::jsonb),
  ('security', '{"session_lifetime_seconds":28800,"require_2fa_for_admins":false,"password_min_length":12}'::jsonb),
  ('retention', '{"audit_days":365,"usage_days":90,"login_history_days":180}'::jsonb),
  ('storage', '{"upload_prefix":"uploads","backup_prefix":"backups"}'::jsonb),
  ('telemetry', '{"enabled":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;
