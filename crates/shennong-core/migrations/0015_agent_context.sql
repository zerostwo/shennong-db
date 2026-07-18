ALTER TABLE chat_threads
  ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX ix_chat_threads_project_owner_updated
  ON chat_threads(project_id, owner_user_id, updated_at DESC)
  WHERE project_id IS NOT NULL;

CREATE TABLE agent_skills (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL CHECK (source_kind IN ('built_in', 'user', 'generated')),
  generation_source TEXT NOT NULL CHECK (generation_source IN ('built_in', 'manual', 'pi', 'template')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled')),
  current_revision INTEGER NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((source_kind = 'built_in') = (owner_user_id IS NULL)),
  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$')
);

CREATE UNIQUE INDEX ux_agent_skills_builtin_slug
  ON agent_skills(slug) WHERE owner_user_id IS NULL;
CREATE UNIQUE INDEX ux_agent_skills_owner_slug
  ON agent_skills(owner_user_id, slug) WHERE owner_user_id IS NOT NULL;
CREATE INDEX ix_agent_skills_owner_status_updated
  ON agent_skills(owner_user_id, status, updated_at DESC);

CREATE TABLE agent_skill_revisions (
  skill_id TEXT NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content TEXT NOT NULL,
  change_note TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (skill_id, revision),
  CHECK (length(content) BETWEEN 1 AND 65536)
);

CREATE OR REPLACE FUNCTION agent_revision_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'agent revisions are immutable';
END;
$$;

CREATE TRIGGER agent_skill_revisions_immutable
BEFORE UPDATE ON agent_skill_revisions
FOR EACH ROW EXECUTE FUNCTION agent_revision_immutable();

CREATE TABLE chat_thread_skills (
  thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, skill_id)
);

CREATE OR REPLACE FUNCTION chat_thread_skill_scope_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  thread_owner TEXT;
  skill_owner TEXT;
  skill_state TEXT;
BEGIN
  SELECT owner_user_id INTO thread_owner FROM chat_threads WHERE id = NEW.thread_id;
  SELECT owner_user_id, status INTO skill_owner, skill_state FROM agent_skills WHERE id = NEW.skill_id;
  IF thread_owner IS NULL OR skill_state IS NULL THEN
    RAISE EXCEPTION 'thread or skill does not exist';
  END IF;
  IF skill_owner IS NOT NULL AND skill_owner <> thread_owner THEN
    RAISE EXCEPTION 'skill is outside the thread owner scope';
  END IF;
  IF NEW.enabled AND skill_state <> 'active' THEN
    RAISE EXCEPTION 'only active skills can be enabled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_thread_skill_scope_guard_trigger
BEFORE INSERT OR UPDATE ON chat_thread_skills
FOR EACH ROW EXECUTE FUNCTION chat_thread_skill_scope_guard();

CREATE TABLE agent_memories (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'conversation', 'imported')),
  source_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  current_revision INTEGER NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_agent_memories_global_owner_updated
  ON agent_memories(owner_user_id, updated_at DESC)
  WHERE project_id IS NULL;
CREATE INDEX ix_agent_memories_project_owner_updated
  ON agent_memories(project_id, owner_user_id, updated_at DESC)
  WHERE project_id IS NOT NULL;

CREATE TABLE agent_memory_revisions (
  memory_id TEXT NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content TEXT NOT NULL,
  change_note TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (memory_id, revision),
  CHECK (length(content) BETWEEN 1 AND 65536)
);

CREATE TRIGGER agent_memory_revisions_immutable
BEFORE UPDATE ON agent_memory_revisions
FOR EACH ROW EXECUTE FUNCTION agent_revision_immutable();

CREATE OR REPLACE FUNCTION agent_project_scope_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = NEW.project_id AND user_id = NEW.owner_user_id
  ) THEN
    RAISE EXCEPTION 'user is not a member of the project';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_memory_project_scope_guard
BEFORE INSERT OR UPDATE OF owner_user_id, project_id ON agent_memories
FOR EACH ROW EXECUTE FUNCTION agent_project_scope_guard();

CREATE TRIGGER chat_thread_project_scope_guard
BEFORE INSERT OR UPDATE OF owner_user_id, project_id ON chat_threads
FOR EACH ROW EXECUTE FUNCTION agent_project_scope_guard();

INSERT INTO agent_skills(id, owner_user_id, slug, name, description, source_kind, generation_source, status)
VALUES
  ('skill-builtin-resource-research', NULL, 'resource-research', 'Resource research',
   'Find and query governed public biomedical Resources with citations.', 'built_in', 'built_in', 'active'),
  ('skill-builtin-dataset-curation', NULL, 'dataset-curation', 'Dataset curation',
   'Inspect uploaded datasets and propose governed normalization steps.', 'built_in', 'built_in', 'active'),
  ('skill-builtin-wet-lab-normalization', NULL, 'wet-lab-normalization', 'Wet-lab normalization',
   'Structure wet-lab observations without inventing measurements or provenance.', 'built_in', 'built_in', 'active');

INSERT INTO agent_skill_revisions(skill_id, revision, content, change_note)
VALUES
  ('skill-builtin-resource-research', 1,
   'Use only governed ShennongDB discovery, inspection, gene-resolution, and query tools. Inspect a Resource before querying it, use only declared operations and exact resolved feature identifiers, and cite every result to its Resource and locator. Never claim that missing data is negative evidence.',
   'Initial built-in skill'),
  ('skill-builtin-dataset-curation', 1,
   'Classify the dataset before proposing changes. Preserve the raw upload, record provenance, describe each normalization step, and ask for confirmation before any write or download. Do not infer assay type or species when the evidence is ambiguous.',
   'Initial built-in skill'),
  ('skill-builtin-wet-lab-normalization', 1,
   'Treat wet-lab values as observations tied to sample, assay, unit, batch, and provenance. Preserve the original value and unit, make conversions explicit, surface missing metadata, and never fabricate replicates or measurements.',
   'Initial built-in skill');
