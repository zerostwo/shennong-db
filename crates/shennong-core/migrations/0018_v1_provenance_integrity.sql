-- V1 defense in depth for immutable Resource history and Artifact lineage.
-- The HTTP layer reports precise client errors; these triggers keep direct SQL
-- and concurrent service writes from bypassing the same production contract.

CREATE FUNCTION enforce_resource_revision_chain() RETURNS TRIGGER AS $$
DECLARE
  expected_parent_id TEXT;
BEGIN
  IF NEW.revision = 1 THEN
    IF NEW.parent_revision_id IS NOT NULL THEN
      RAISE EXCEPTION 'the first resource revision cannot have a parent'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT id INTO expected_parent_id
    FROM resource_revisions
    WHERE resource_id = NEW.resource_id
      AND revision = NEW.revision - 1;

    IF expected_parent_id IS NULL THEN
      RAISE EXCEPTION 'the preceding resource revision is missing'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.parent_revision_id IS DISTINCT FROM expected_parent_id THEN
      RAISE EXCEPTION 'resource revision parent must be the preceding revision'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER resource_revisions_linear_history
BEFORE INSERT ON resource_revisions
FOR EACH ROW EXECUTE FUNCTION enforce_resource_revision_chain();

CREATE FUNCTION enforce_artifact_provenance_integrity() RETURNS TRIGGER AS $$
DECLARE
  parent JSONB;
  parent_id TEXT;
  parent_immutable BOOLEAN;
BEGIN
  IF jsonb_typeof(NEW.schema_json) IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW.provenance) IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW.derived_from) IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'artifact schema, provenance, and lineage have invalid JSON shapes'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.checksum IS NOT NULL
    AND regexp_replace(NEW.checksum, '^sha256:', '') !~ '^[0-9a-fA-F]{64}$'
  THEN
    RAISE EXCEPTION 'artifact checksum must be sha256'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.content_sha256 IS NOT NULL
    AND NEW.content_sha256 !~ '^[0-9a-fA-F]{64}$'
  THEN
    RAISE EXCEPTION 'artifact content_sha256 must be sha256'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.data_class = 'raw' THEN
    IF NOT NEW.immutable
      OR NEW.checksum IS NULL
      OR NEW.content_sha256 IS NULL
      OR lower(regexp_replace(NEW.checksum, '^sha256:', ''))
        IS DISTINCT FROM lower(NEW.content_sha256)
    THEN
      RAISE EXCEPTION 'raw artifacts require matching immutable sha256 integrity'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.data_class = 'derived' AND jsonb_array_length(NEW.derived_from) = 0 THEN
    RAISE EXCEPTION 'derived artifacts require lineage'
      USING ERRCODE = '23514';
  END IF;

  FOR parent IN SELECT value FROM jsonb_array_elements(NEW.derived_from)
  LOOP
    IF jsonb_typeof(parent) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'artifact lineage entries must be artifact identifiers'
        USING ERRCODE = '23514';
    END IF;
    parent_id := parent #>> '{}';
    IF parent_id = NEW.id THEN
      RAISE EXCEPTION 'artifact cannot derive from itself'
        USING ERRCODE = '23514';
    END IF;
    SELECT immutable INTO parent_immutable
    FROM artifacts
    WHERE id = parent_id
    FOR KEY SHARE;
    IF parent_immutable IS NULL THEN
      RAISE EXCEPTION 'artifact lineage reference does not exist'
        USING ERRCODE = '23514';
    END IF;
    IF NOT parent_immutable THEN
      RAISE EXCEPTION 'artifact lineage parents must be immutable'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.resource_id IS DISTINCT FROM NEW.resource_id THEN
      RAISE EXCEPTION 'artifact identity cannot move between Resources'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.immutable AND (
      OLD.uri IS DISTINCT FROM NEW.uri
      OR OLD.format IS DISTINCT FROM NEW.format
      OR OLD.size IS DISTINCT FROM NEW.size
      OR OLD.checksum IS DISTINCT FROM NEW.checksum
      OR OLD.storage_backend IS DISTINCT FROM NEW.storage_backend
      OR OLD.data_class IS DISTINCT FROM NEW.data_class
      OR OLD.immutable IS DISTINCT FROM NEW.immutable
      OR OLD.content_sha256 IS DISTINCT FROM NEW.content_sha256
      OR OLD.source_uri IS DISTINCT FROM NEW.source_uri
      OR OLD.derived_from IS DISTINCT FROM NEW.derived_from
      OR OLD.pipeline_version IS DISTINCT FROM NEW.pipeline_version
      OR OLD.retention_policy IS DISTINCT FROM NEW.retention_policy
      OR OLD.storage_uri IS DISTINCT FROM NEW.storage_uri
      OR OLD.schema_json IS DISTINCT FROM NEW.schema_json
      OR OLD.provenance IS DISTINCT FROM NEW.provenance
    ) THEN
      RAISE EXCEPTION 'immutable artifacts cannot be changed'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER artifacts_provenance_integrity
BEFORE INSERT OR UPDATE ON artifacts
FOR EACH ROW EXECUTE FUNCTION enforce_artifact_provenance_integrity();

CREATE INDEX ix_artifacts_derived_from_gin
ON artifacts USING GIN (derived_from);

CREATE FUNCTION reject_artifact_delete_with_lineage() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.immutable THEN
    RAISE EXCEPTION 'immutable artifacts cannot be deleted'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM artifacts
    WHERE id <> OLD.id
      AND derived_from ? OLD.id
  ) THEN
    RAISE EXCEPTION 'artifacts referenced by lineage cannot be deleted'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER artifacts_delete_integrity
BEFORE DELETE ON artifacts
FOR EACH ROW EXECUTE FUNCTION reject_artifact_delete_with_lineage();
