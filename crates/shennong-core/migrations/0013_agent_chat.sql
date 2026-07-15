UPDATE system_settings
SET value = value || '{"registration_mode":"open"}'::jsonb,
    updated_at = NOW()
WHERE key = 'general' AND NOT (value ? 'registration_mode');

CREATE TABLE model_providers (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider_kind TEXT NOT NULL CHECK (provider_kind IN ('openai', 'deepseek', 'ollama', 'openai-compatible')),
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  data_policy TEXT NOT NULL DEFAULT 'public_only' CHECK (data_policy IN ('public_only', 'allow_private')),
  encrypted_api_key BYTEA,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, name)
);
CREATE INDEX ix_model_providers_owner_updated ON model_providers(owner_user_id, updated_at DESC);
CREATE UNIQUE INDEX ux_model_providers_owner_default
  ON model_providers(owner_user_id) WHERE is_default;

CREATE TABLE chat_threads (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  provider_id TEXT REFERENCES model_providers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_chat_threads_owner_updated ON chat_threads(owner_user_id, updated_at DESC);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_chat_messages_thread_created ON chat_messages(thread_id, created_at, id);
