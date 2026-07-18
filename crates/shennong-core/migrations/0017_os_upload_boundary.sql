-- Shennong OS owns identity and Project RBAC in the V1 headless deployment.
-- Platform uploads keep the authoritative OS UUIDs as opaque provenance. The
-- legacy user_id foreign key remains intact; only its NOT NULL requirement is
-- relaxed so a platform upload never needs a duplicate DB-local user row.
ALTER TABLE uploads
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN os_actor_id TEXT,
  ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  ADD CONSTRAINT uploads_identity_boundary CHECK (
    (
      project_id IS NULL
      AND user_id IS NOT NULL
      AND os_actor_id IS NULL
    ) OR (
      project_id IS NOT NULL
      AND user_id IS NULL
      AND os_actor_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  ),
  ADD CONSTRAINT uploads_platform_project_uuid CHECK (
    project_id IS NULL OR project_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

CREATE INDEX ix_uploads_project_created
  ON uploads(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

COMMENT ON COLUMN uploads.user_id IS
  'Legacy ShennongDB user ID; NULL for OS Project-scoped uploads.';
COMMENT ON COLUMN uploads.os_actor_id IS
  'Opaque Shennong OS actor UUID; set only for Project-scoped uploads.';
COMMENT ON COLUMN uploads.project_id IS
  'Authoritative Shennong OS Project UUID; NULL only for legacy standalone uploads.';
