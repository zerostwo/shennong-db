ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS data_class TEXT NOT NULL DEFAULT 'canonical',
  ADD COLUMN IF NOT EXISTS immutable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS content_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS source_uri TEXT,
  ADD COLUMN IF NOT EXISTS derived_from JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pipeline_version TEXT,
  ADD COLUMN IF NOT EXISTS retention_policy TEXT,
  ADD COLUMN IF NOT EXISTS storage_uri TEXT;

ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_data_class_check
  CHECK (data_class IN ('raw', 'canonical', 'derived', 'cache', 'staging'));

CREATE INDEX IF NOT EXISTS ix_artifacts_content_sha256
  ON artifacts(content_sha256)
  WHERE content_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_artifacts_data_class
  ON artifacts(resource_id, data_class);
