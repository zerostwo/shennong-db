# Shennong Web UI Product Spec

## Design Direction

Shennong Web is a scientific workbench. It should feel closer to a focused
research application than a marketing website.

Reference products:

- CELLxGENE Discover for dataset catalog, gene expression, explorer, and cell
  type discovery patterns.
- ChatGPT for conversation structure and low-friction prompt entry.
- Codex for a workbench-style layout where actions, traces, and results remain
  visible.

The UI should be dense but not cluttered: strong tables, clear filters, compact
summary metrics, data visualizations, and a persistent agent panel.

## Primary Users

### Dataset Curator

Uploads, validates, versions, and publishes lab datasets.

Needs:

- Manage private draft datasets.
- Validate data before release.
- See ingestion errors.
- Publish a version with citation and schema.

### Bench Scientist

Asks gene, cell type, disease, and prognosis questions through the Web UI.

Needs:

- Search datasets.
- Explore expression and cell states.
- Ask an agent questions without writing code.
- Export charts and tables.

### Bioinformatics Analyst

Uses R first, and later Python, for programmatic analysis.

Needs:

- Copy exact R examples.
- Lazy access to query slices.
- Download only intended subsets.
- Reproduce Web/agent analyses.

## Navigation

Primary navigation:

- Catalog
- Explore
- Agent
- Publish
- Admin

Secondary workspace controls:

- Dataset selector
- Version selector
- Gene search
- Metadata filters
- Analysis mode tabs
- Tool trace panel

## Screens

### Catalog

Purpose: choose a dataset.

Elements:

- Search input
- Modality filters
- Visibility filters
- Dataset table/cards
- Dataset metrics
- Default version and backend
- Quick actions: Explore, Chat, Copy R

### Dataset Detail

Purpose: understand if a dataset is usable.

Elements:

- Shareable route `/datasets/:dataset_id`
- Title and citation
- Release status
- Modalities and assays
- Schema fields
- Available analyses
- Versions
- R and API snippets
- Data license and contact

### Explore

Purpose: interact with data slices.

Elements:

- Dataset and version selector
- Gene search
- Cohort/filter builder
- UMAP or spatial panel
- Gene expression plot
- Survival plot
- Result table preview
- Query provenance

### Agent

Purpose: ask dataset-grounded questions.

Elements:

- Dataset context chip
- Message history
- Prompt input
- Suggested prompts
- Tool trace
- Generated figures/tables
- Reproducible code block

### Publish

Purpose: publish a dataset.

Elements:

- Manifest upload
- File upload or server path input
- Schema validation
- Backend target selection
- Draft/release state
- Visibility controls
- Validation report

### Admin

Purpose: manage users, projects, and access.

Elements:

- Organization and project switcher
- Members and roles
- API tokens
- Audit events
- Backend health

## First Implemented UI Slice

The first Web implementation should include:

- App shell with sidebar and top command area.
- Catalog panel using live API with mock fallback.
- Explorer panel with realistic visualizations and filters.
- Agent panel with deterministic tool-call simulation.
- Publish panel skeleton that shows the intended flow.
- Admin health and access summary skeleton.

## Interaction Requirements

- Catalog search filters datasets instantly.
- Dataset selection updates explorer and agent context.
- Dataset rows open shareable release pages at `/datasets/:dataset_id`.
- Dataset context renders release metadata, versions, schema, capabilities, and R/API/agent examples.
- Gene search can trigger expression query when the API is available.
- Agent prompt entry appends a user message, shows a tool trace, and displays a
  grounded assistant response.
- Publish controls call `/v1/ingest/validate` and render the server validation report,
  including source preview, queryability, and schema issues when available.
- Upload validation calls `/v1/ingest/upload/validate` before registration and renders
  the same report shape.
- Layout must work on desktop and mobile widths.

## Visual Requirements

- Use compact app navigation, not a landing-page hero.
- Use restrained neutral surfaces with a few meaningful biomedical accent
  colors.
- Keep repeated dataset items as cards or table rows, but avoid nested cards.
- Use icons for navigation and commands.
- Keep charts readable and aligned.
- Never let labels overflow buttons, tabs, or controls.

## API Integration

The Web app should read:

- `GET /v1/catalog/datasets`
- `GET /v1/catalog/datasets/{dataset_id}`
- `POST /v1/query`
- `GET /v1/agent/tools`
- `POST /v1/agent/call`

Admin/publishing will later use:

- `POST /v1/datasets`
- `POST /v1/ingest`
- `POST /v1/ingest/validate`
- `POST /v1/ingest/upload/validate`
- `POST /v1/ingest/upload`

During early development, API failures should fall back to mock data so the UI
can still be reviewed.
