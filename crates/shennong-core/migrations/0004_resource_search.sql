CREATE INDEX ix_resources_metadata_search ON resources
USING GIN (to_tsvector('simple', id || ' ' || kind || ' ' || metadata::text));
