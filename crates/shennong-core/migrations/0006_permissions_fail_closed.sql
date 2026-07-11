ALTER TABLE resources
  ALTER COLUMN permissions SET DEFAULT '{"visibility":"private","read_scopes":["resource.read"]}'::jsonb;

DO $$
DECLARE
  repaired_count INTEGER;
BEGIN
  WITH repaired AS (
    UPDATE resources
    SET permissions = '{"visibility":"private","read_scopes":["resource.read"]}'::jsonb
    WHERE NOT (
      jsonb_typeof(permissions) = 'object'
      AND permissions->>'visibility' IN ('public', 'private')
      AND jsonb_typeof(permissions->'read_scopes') = 'array'
      AND jsonb_array_length(permissions->'read_scopes') > 0
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(permissions->'read_scopes') AS scope
        WHERE jsonb_typeof(scope) <> 'string'
          OR length(scope #>> '{}') = 0
          OR length(scope #>> '{}') > 128
          OR scope #>> '{}' !~ '^[A-Za-z0-9._:-]+$'
      )
    )
    RETURNING 1
  )
  SELECT count(*) INTO repaired_count FROM repaired;

  IF repaired_count > 0 THEN
    RAISE WARNING 'migrated % resources with invalid permissions to private', repaired_count;
  END IF;
END $$;
