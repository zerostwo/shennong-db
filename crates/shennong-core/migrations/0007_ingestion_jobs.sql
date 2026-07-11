UPDATE resources
SET status = 'materializing'
WHERE status = 'processing';

UPDATE resources
SET status = 'unavailable'
WHERE status NOT IN ('registered', 'downloading', 'verifying', 'materializing', 'available', 'failed', 'unavailable');

ALTER TABLE resources
  ALTER COLUMN status SET DEFAULT 'registered';

ALTER TABLE resources
  ADD CONSTRAINT resources_status_check
  CHECK (status IN ('registered', 'downloading', 'verifying', 'materializing', 'available', 'failed', 'unavailable'));

CREATE TABLE ingestion_jobs (
  id TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL,
  provider_version TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('registered', 'downloading', 'verifying', 'materializing', 'available', 'failed', 'unavailable')),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_name, provider_version)
);

CREATE INDEX ix_ingestion_jobs_resource_id ON ingestion_jobs(resource_id);
