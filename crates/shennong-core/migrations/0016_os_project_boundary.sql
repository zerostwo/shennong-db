-- Shennong OS owns identity and Project RBAC in the V1 headless deployment.
-- Keep owner_user_id as provenance for the authoritative OS Project without
-- requiring a duplicate ShennongDB user row.
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_owner_user_id_fkey;

COMMENT ON COLUMN projects.owner_user_id IS
  'Opaque Shennong OS user identifier; not a ShennongDB identity foreign key.';
