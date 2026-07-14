CREATE TABLE projects (
  id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 256),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 512),
  description TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('public', 'private')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_projects_owner ON projects(owner_user_id);
CREATE INDEX ix_projects_visibility_status ON projects(visibility, status, updated_at DESC);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX ix_project_members_user ON project_members(user_id, role, project_id);
CREATE UNIQUE INDEX ux_project_members_owner ON project_members(project_id) WHERE role = 'owner';

CREATE TABLE studies (
  id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 256),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 512),
  description TEXT NOT NULL DEFAULT '',
  design_type TEXT NOT NULL DEFAULT 'generic' CHECK (char_length(design_type) BETWEEN 1 AND 128),
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'active', 'completed', 'archived')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provenance) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, project_id)
);
CREATE INDEX ix_studies_project_status ON studies(project_id, status, updated_at DESC);

CREATE TABLE research_entities (
  id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 256),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  study_id TEXT,
  category TEXT NOT NULL CHECK (category IN (
    'subject', 'cohort', 'sample', 'biospecimen', 'aliquot', 'bioentity',
    'material', 'reagent', 'model', 'data_product', 'result', 'observation', 'claim',
    'external_reference', 'other'
  )),
  kind TEXT NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 128),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 1024),
  ontology_id TEXT,
  canonical_key TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'deprecated')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provenance) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (study_id IS NULL OR project_id IS NOT NULL),
  FOREIGN KEY (study_id, project_id) REFERENCES studies(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX ix_research_entities_project_category_status
  ON research_entities(project_id, category, status, updated_at DESC);
CREATE INDEX ix_research_entities_study ON research_entities(study_id) WHERE study_id IS NOT NULL;
CREATE INDEX ix_research_entities_ontology ON research_entities(ontology_id) WHERE ontology_id IS NOT NULL;
CREATE INDEX ix_research_entities_canonical ON research_entities(canonical_key) WHERE canonical_key IS NOT NULL;
CREATE INDEX ix_research_entities_search ON research_entities USING GIN (
  to_tsvector('simple',
    label || ' ' || kind || ' ' || category || ' ' ||
    COALESCE(ontology_id, '') || ' ' || COALESCE(canonical_key, ''))
);

CREATE TABLE research_activities (
  id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 256),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_id TEXT,
  kind TEXT NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 128),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 1024),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'awaiting_approval', 'running', 'validating', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(parameters) = 'object'),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provenance) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at),
  FOREIGN KEY (study_id, project_id) REFERENCES studies(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX ix_research_activities_project_status
  ON research_activities(project_id, status, updated_at DESC);
CREATE INDEX ix_research_activities_study ON research_activities(study_id) WHERE study_id IS NOT NULL;
CREATE INDEX ix_research_activities_kind ON research_activities(kind, status);

CREATE TABLE activity_io (
  activity_id TEXT NOT NULL REFERENCES research_activities(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES research_entities(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('input', 'output')),
  role TEXT NOT NULL CHECK (char_length(role) BETWEEN 1 AND 128),
  ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (activity_id, entity_id, direction, role)
);
CREATE INDEX ix_activity_io_entity ON activity_io(entity_id, direction, activity_id);

CREATE TABLE activity_actors (
  activity_id TEXT NOT NULL REFERENCES research_activities(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'software', 'instrument', 'organization')),
  actor_id TEXT NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 256),
  role TEXT NOT NULL CHECK (char_length(role) BETWEEN 1 AND 128),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (activity_id, actor_type, actor_id, role)
);
CREATE INDEX ix_activity_actors_actor ON activity_actors(actor_type, actor_id, activity_id);

CREATE TABLE resource_revisions (
  id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 256),
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  parent_revision_id TEXT,
  content_sha256 TEXT CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-fA-F]{64}$'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  spec JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(spec) = 'object'),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provenance) = 'object'),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (resource_id, revision),
  UNIQUE (id, resource_id),
  FOREIGN KEY (parent_revision_id, resource_id)
    REFERENCES resource_revisions(id, resource_id) ON DELETE RESTRICT
);
CREATE INDEX ix_resource_revisions_resource ON resource_revisions(resource_id, revision DESC);
CREATE INDEX ix_resource_revisions_parent ON resource_revisions(parent_revision_id) WHERE parent_revision_id IS NOT NULL;

CREATE FUNCTION reject_resource_revision_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'resource revisions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER resource_revisions_immutable
BEFORE UPDATE OR DELETE ON resource_revisions
FOR EACH ROW EXECUTE FUNCTION reject_resource_revision_mutation();

CREATE TABLE graph_associations (
  id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 256),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES research_entities(id) ON DELETE RESTRICT,
  predicate TEXT NOT NULL CHECK (char_length(predicate) BETWEEN 1 AND 256),
  object_id TEXT NOT NULL REFERENCES research_entities(id) ON DELETE RESTRICT,
  qualifiers JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(qualifiers) = 'object'),
  polarity TEXT NOT NULL DEFAULT 'neutral'
    CHECK (polarity IN ('positive', 'negative', 'neutral', 'mixed')),
  knowledge_level TEXT NOT NULL DEFAULT 'observation'
    CHECK (knowledge_level IN ('observation', 'assertion', 'hypothesis', 'prediction')),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'active', 'validated', 'refuted', 'superseded', 'retracted')),
  scope TEXT NOT NULL DEFAULT 'project'
    CHECK (scope IN ('project', 'public')),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provenance) = 'object'),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (subject_id <> object_id),
  CHECK ((scope = 'project' AND project_id IS NOT NULL) OR (scope = 'public' AND project_id IS NULL))
);
CREATE INDEX ix_graph_associations_project_status
  ON graph_associations(project_id, status, updated_at DESC);
CREATE INDEX ix_graph_associations_subject_predicate
  ON graph_associations(subject_id, predicate, status, scope);
CREATE INDEX ix_graph_associations_object_predicate
  ON graph_associations(object_id, predicate, status, scope);
CREATE INDEX ix_graph_associations_scope_status_spo
  ON graph_associations(scope, status, subject_id, predicate, object_id);

CREATE FUNCTION enforce_graph_association_scope() RETURNS TRIGGER AS $$
DECLARE
  subject_project TEXT;
  object_project TEXT;
BEGIN
  SELECT project_id INTO subject_project FROM research_entities WHERE id = NEW.subject_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'graph association subject does not exist';
  END IF;
  SELECT project_id INTO object_project FROM research_entities WHERE id = NEW.object_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'graph association object does not exist';
  END IF;

  IF NEW.scope = 'public' THEN
    IF subject_project IS NOT NULL OR object_project IS NOT NULL THEN
      RAISE EXCEPTION 'public associations require global entities';
    END IF;
  ELSIF (subject_project IS NOT NULL AND subject_project <> NEW.project_id)
     OR (object_project IS NOT NULL AND object_project <> NEW.project_id) THEN
    RAISE EXCEPTION 'project association endpoints must be global or in the same project';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER graph_associations_scope_guard
BEFORE INSERT OR UPDATE ON graph_associations
FOR EACH ROW EXECUTE FUNCTION enforce_graph_association_scope();

CREATE TABLE evidence_items (
  id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 256),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL CHECK (char_length(evidence_type) BETWEEN 1 AND 128),
  source_uri TEXT,
  source_id TEXT,
  locator JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(locator) = 'object'),
  statistics JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(statistics) = 'object'),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provenance) = 'object'),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (source_uri IS NOT NULL OR source_id IS NOT NULL OR locator <> '{}'::jsonb)
);
CREATE INDEX ix_evidence_items_project_type ON evidence_items(project_id, evidence_type, created_at DESC);
CREATE INDEX ix_evidence_items_source ON evidence_items(source_id) WHERE source_id IS NOT NULL;

CREATE TABLE association_evidence (
  association_id TEXT NOT NULL REFERENCES graph_associations(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  stance TEXT NOT NULL CHECK (stance IN ('supporting', 'contradicting', 'neutral')),
  weight DOUBLE PRECISION CHECK (weight IS NULL OR (weight >= 0 AND weight <= 1)),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (association_id, evidence_id)
);
CREATE INDEX ix_association_evidence_evidence ON association_evidence(evidence_id, stance, association_id);

CREATE FUNCTION enforce_association_evidence_scope() RETURNS TRIGGER AS $$
DECLARE
  association_project TEXT;
  association_scope TEXT;
  evidence_project TEXT;
BEGIN
  SELECT project_id, scope INTO association_project, association_scope
  FROM graph_associations WHERE id = NEW.association_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'graph association does not exist';
  END IF;
  SELECT project_id INTO evidence_project FROM evidence_items WHERE id = NEW.evidence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence item does not exist';
  END IF;

  IF association_scope = 'public' AND evidence_project IS NOT NULL THEN
    RAISE EXCEPTION 'public associations require public evidence';
  ELSIF association_scope = 'project'
    AND evidence_project IS NOT NULL
    AND evidence_project <> association_project THEN
    RAISE EXCEPTION 'project associations require same-project or public evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER association_evidence_scope_guard
BEFORE INSERT OR UPDATE ON association_evidence
FOR EACH ROW EXECUTE FUNCTION enforce_association_evidence_scope();

CREATE TABLE project_resource_bindings (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (char_length(role) BETWEEN 1 AND 128),
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, resource_id, role)
);
CREATE INDEX ix_project_resource_bindings_resource ON project_resource_bindings(resource_id, project_id);

CREATE TABLE resource_graph_bindings (
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  entity_id TEXT NOT NULL REFERENCES research_entities(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (char_length(role) BETWEEN 1 AND 128),
  revision_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (resource_id, entity_id, role),
  FOREIGN KEY (revision_id, resource_id)
    REFERENCES resource_revisions(id, resource_id) ON DELETE RESTRICT
);
CREATE INDEX ix_resource_graph_bindings_entity ON resource_graph_bindings(entity_id, role, resource_id);
CREATE INDEX ix_resource_graph_bindings_revision ON resource_graph_bindings(revision_id) WHERE revision_id IS NOT NULL;
