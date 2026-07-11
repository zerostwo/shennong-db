CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'available',
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  permissions JSONB NOT NULL DEFAULT '{"visibility":"public","read_scopes":["resource.read"]}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  format TEXT NOT NULL,
  size BIGINT,
  checksum TEXT,
  storage_backend TEXT NOT NULL,
  schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_artifacts_resource_id ON artifacts(resource_id);

CREATE TABLE relations (
  source TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  target TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, target, relation_type)
);
CREATE INDEX ix_relations_target ON relations(target);
