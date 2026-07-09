export type DataModel = "bulk" | "single_cell" | "spatial" | "clinical" | "qtl" | "table";

export interface DatasetSummary {
  dataset: string;
  title: string;
  data_model: DataModel;
  assays: string[];
  default_version: string | null;
  backend: string;
  visibility: string;
}

export interface DatasetDetail extends DatasetSummary {
  description?: string | null;
  versions: string[];
  citation?: string | null;
  license?: string | null;
  status: string;
  publication_state: string;
  source_roles: string[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CatalogField {
  field: string;
  type: string;
  scope: string;
}

export interface DatasetSchema {
  dataset?: string;
  version?: string;
  data_model?: DataModel;
  assays?: string[];
  observation?: {
    type?: string;
    id_field?: string;
    fields?: Record<string, string>;
  };
  feature?: {
    type?: string;
    id_fields?: string[];
    fields?: Record<string, string>;
  };
  layers?: string[];
  embeddings?: string[];
  measures?: string[];
  return_shapes?: string[];
  return_formats?: string[];
  [key: string]: unknown;
}

export interface DatasetCapabilities {
  dataset?: string;
  can_filter_observations?: boolean;
  can_filter_features?: boolean;
  can_query_matrix?: boolean;
  can_compute_pseudobulk?: boolean;
  can_compute_de?: boolean;
  can_compute_signature_score?: boolean;
  can_query_embedding?: boolean;
  can_export_seurat?: boolean;
  can_export_h5ad?: boolean;
  max_sync_cells?: number;
  max_sync_features?: number;
  async_required_above_cells?: number;
  [key: string]: unknown;
}

export interface QueryRow {
  [key: string]: string | number | boolean | null | undefined;
}

export interface QueryResponse {
  status: string;
  data: QueryRow[];
  meta: {
    dataset: string;
    version: string;
    backend: string;
    n_rows: number;
    columns: string[];
    elapsed_ms: number;
    cached?: boolean;
    next_cursor?: string | null;
  };
}

export interface QuerySpec {
  dataset: string;
  version: string;
  assay: string;
  data_model: DataModel;
  select: {
    features: string[];
    observations: Record<string, string | string[] | number | boolean | null>;
    fields: string[];
  };
  layer: string | null;
  measure: string;
  return: { format: "json"; shape: "tidy" | "table" };
  options: { limit: number; cursor?: string | null };
}

export interface ApiStatus {
  ok: boolean;
  source: "live" | "mock";
  message: string;
}

export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AgentCallResponse<TData = unknown, TMeta = Record<string, unknown>> {
  status: string;
  tool: string;
  data: TData;
  meta: TMeta;
}

export interface IngestRegistrationPayload {
  dataset: string;
  version: string;
  data_model: DataModel;
  backend: string;
  source?: Record<string, string>;
  metadata?: Record<string, unknown>;
  citation?: string | null;
  register?: boolean;
  is_default?: boolean;
}

export interface UploadDatasetPayload {
  dataset: string;
  version: string;
  data_model: DataModel;
  backend: string;
  role: string;
  file: File;
  metadata?: Record<string, unknown>;
  citation?: string | null;
  register?: boolean;
  is_default?: boolean;
}

export interface UploadPreview {
  filename: string;
  content_type?: string | null;
  size_bytes: number;
  delimiter?: string | null;
  columns: string[];
  sample_rows: Array<Record<string, string | number | boolean | null>>;
  sampled_rows: number;
  truncated: boolean;
  warnings: string[];
}

export interface IngestResponse {
  status: string;
  job_id: string;
  state: string;
  dataset: string;
  version: string;
  registered: boolean;
  message?: string | null;
  preview?: UploadPreview | null;
}

export interface IngestValidationIssue {
  level: "error" | "warning" | "info";
  field: string;
  message: string;
  details: Record<string, unknown>;
}

export interface IngestValidationReport {
  status: string;
  valid: boolean;
  queryable: boolean;
  dataset: string;
  version: string;
  data_model: DataModel;
  backend: string;
  dataset_type?: string | null;
  required_source_roles: string[];
  present_source_roles: string[];
  storage_uri?: string | null;
  issues: IngestValidationIssue[];
  preview?: UploadPreview | null;
}

export interface AdminUser {
  user_id: string;
  email: string;
  display_name: string;
  is_superuser: boolean;
}

export interface AdminOrganization {
  org_id: string;
  slug: string;
  name: string;
}

export interface AdminProject {
  project_id: string;
  org_id: string;
  slug: string;
  name: string;
  visibility: string;
}

export interface AuditEvent {
  event_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  created_at?: string | null;
}

export interface AdminOverview {
  users: AdminUser[];
  organizations: AdminOrganization[];
  projects: AdminProject[];
  events: AuditEvent[];
}

export interface BootstrapPayload {
  user: {
    email: string;
    display_name: string;
    is_superuser: boolean;
  };
  organization: {
    slug: string;
    name: string;
  };
}

export interface BootstrapResponse {
  user: AdminUser;
  organization: AdminOrganization;
  membership: {
    membership_id: string;
    org_id: string;
    user_id: string;
    role: string;
  };
}

const API_URL = import.meta.env.VITE_SHENNONG_API_URL ?? "";

export const mockDatasets: DatasetSummary[] = [
  {
    dataset: "toil",
    title: "TCGA TARGET GTEx Toil RNA-seq",
    data_model: "bulk",
    assays: ["rna"],
    default_version: "2026.07",
    backend: "xena",
    visibility: "public"
  },
  {
    dataset: "pbmc3k",
    title: "PBMC3k filtered 10x matrix",
    data_model: "single_cell",
    assays: ["rna"],
    default_version: "2026.07",
    backend: "tenx_h5",
    visibility: "public"
  },
  {
    dataset: "toil_survival",
    title: "TCGA TARGET GTEx Toil Survival",
    data_model: "clinical",
    assays: ["clinical"],
    default_version: "2026.07",
    backend: "clickhouse",
    visibility: "public"
  },
  {
    dataset: "pan_cancer_tcell_atlas",
    title: "Pan-cancer T cell atlas",
    data_model: "single_cell",
    assays: ["rna", "cell_state"],
    default_version: "draft",
    backend: "tiledb_soma",
    visibility: "private"
  }
];

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "content-type": "application/json" }),
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function adminHeaders(adminToken: string): Record<string, string> {
  return adminToken ? { "X-Shennong-Admin-Key": adminToken } : {};
}

export async function fetchDatasets(): Promise<{ datasets: DatasetSummary[]; status: ApiStatus }> {
  try {
    const response = await requestJson<{ data: DatasetSummary[] }>("/v1/catalog/datasets");
    return {
      datasets: response.data,
      status: { ok: true, source: "live", message: "Connected to Shennong Data Server" }
    };
  } catch (error) {
    return {
      datasets: mockDatasets,
      status: {
        ok: false,
        source: "mock",
        message: error instanceof Error ? error.message : "Using mock data"
      }
    };
  }
}

export async function fetchDatasetDetail(datasetId: string): Promise<DatasetDetail> {
  const response = await requestJson<{ data: DatasetDetail }>(
    `/v1/catalog/datasets/${encodeURIComponent(datasetId)}`
  );
  return response.data;
}

export async function fetchDatasetSchema(
  datasetId: string,
  version?: string | null
): Promise<DatasetSchema> {
  const query = version ? `?version=${encodeURIComponent(version)}` : "";
  const response = await requestJson<{ data: DatasetSchema }>(
    `/v1/catalog/datasets/${encodeURIComponent(datasetId)}/schema${query}`
  );
  return response.data;
}

export async function fetchDatasetCapabilities(
  datasetId: string,
  version?: string | null
): Promise<DatasetCapabilities> {
  const query = version ? `?version=${encodeURIComponent(version)}` : "";
  const response = await requestJson<{ data: DatasetCapabilities }>(
    `/v1/catalog/datasets/${encodeURIComponent(datasetId)}/capabilities${query}`
  );
  return response.data;
}

export async function fetchDatasetFields(
  datasetId: string,
  version?: string | null
): Promise<CatalogField[]> {
  const query = version ? `?version=${encodeURIComponent(version)}` : "";
  const response = await requestJson<{ data: CatalogField[] }>(
    `/v1/catalog/datasets/${encodeURIComponent(datasetId)}/fields${query}`
  );
  return response.data;
}

export async function queryDataset(
  dataset: DatasetSummary,
  gene: string,
  limit = 200
): Promise<QueryResponse> {
  const payload = buildQuerySpec(dataset, gene, limit);
  return requestJson<QueryResponse>("/v1/query", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function buildQuerySpec(dataset: DatasetSummary, gene: string, limit = 200): QuerySpec {
  const observations: Record<string, string | string[] | number | boolean | null> = {};
  if (dataset.dataset === "toil") {
    observations.cancer = "PAAD";
  }
  const assay = dataset.data_model === "clinical" ? "clinical" : "rna";
  return {
    dataset: dataset.dataset,
    version: "latest",
    assay,
    data_model: dataset.data_model,
    select: {
      features: dataset.data_model === "clinical" ? [] : [gene],
      observations,
      fields: []
    },
    layer: dataset.data_model === "clinical" ? null : "log2_tpm",
    measure: dataset.data_model === "clinical" ? "survival" : "expression",
    return: { format: "json", shape: "tidy" },
    options: { limit }
  };
}

export async function fetchAgentTools(): Promise<AgentTool[]> {
  const response = await requestJson<{ tools: AgentTool[] }>("/v1/agent/tools");
  return response.tools;
}

export async function callAgentTool<TData = unknown, TMeta = Record<string, unknown>>(
  tool: string,
  args: unknown
): Promise<AgentCallResponse<TData, TMeta>> {
  return requestJson<AgentCallResponse<TData, TMeta>>("/v1/agent/call", {
    method: "POST",
    body: JSON.stringify({ tool, args })
  });
}

export async function agentQueryDataset(
  dataset: DatasetSummary,
  gene: string,
  limit = 200
): Promise<QueryResponse> {
  const spec = buildQuerySpec(dataset, gene, limit);
  const response = await callAgentTool<QueryRow[], QueryResponse["meta"]>("query_data", spec);
  return {
    status: response.status,
    data: response.data,
    meta: response.meta
  };
}

export async function publishDatasetRegistration(
  adminToken: string,
  payload: IngestRegistrationPayload
): Promise<IngestResponse> {
  return requestJson<IngestResponse>("/v1/ingest", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({
      register: true,
      is_default: true,
      source: {},
      metadata: {},
      ...payload
    })
  });
}

export async function validateIngestManifest(
  adminToken: string,
  payload: IngestRegistrationPayload
): Promise<IngestValidationReport> {
  return requestJson<IngestValidationReport>("/v1/ingest/validate", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: JSON.stringify({
      register: true,
      is_default: true,
      source: {},
      metadata: {},
      ...payload
    })
  });
}

export async function validateUploadDatasetFile(
  adminToken: string,
  payload: UploadDatasetPayload
): Promise<IngestValidationReport> {
  const form = new FormData();
  form.append("file", payload.file);
  form.append("dataset", payload.dataset);
  form.append("version", payload.version);
  form.append("data_model", payload.data_model);
  form.append("backend", payload.backend);
  form.append("role", payload.role);
  form.append("is_default", String(payload.is_default ?? true));
  if (payload.metadata) {
    form.append("metadata_json", JSON.stringify(payload.metadata));
  }
  if (payload.citation) {
    form.append("citation", payload.citation);
  }
  return requestJson<IngestValidationReport>("/v1/ingest/upload/validate", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: form
  });
}

export async function uploadDatasetFile(
  adminToken: string,
  payload: UploadDatasetPayload
): Promise<IngestResponse> {
  const form = new FormData();
  form.append("file", payload.file);
  form.append("dataset", payload.dataset);
  form.append("version", payload.version);
  form.append("data_model", payload.data_model);
  form.append("backend", payload.backend);
  form.append("role", payload.role);
  form.append("register", String(payload.register ?? true));
  form.append("is_default", String(payload.is_default ?? true));
  if (payload.metadata) {
    form.append("metadata_json", JSON.stringify(payload.metadata));
  }
  if (payload.citation) {
    form.append("citation", payload.citation);
  }
  return requestJson<IngestResponse>("/v1/ingest/upload", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: form
  });
}

export async function bootstrapAccess(
  adminToken: string,
  payload: BootstrapPayload
): Promise<BootstrapResponse> {
  return requestJson<BootstrapResponse>("/v1/admin/bootstrap", {
    method: "POST",
    headers: adminHeaders(adminToken),
    body: JSON.stringify(payload)
  });
}

export async function fetchAdminOverview(adminToken: string): Promise<AdminOverview> {
  const headers = adminHeaders(adminToken);
  const [users, organizations, projects, events] = await Promise.all([
    requestJson<{ users: AdminUser[] }>("/v1/admin/users", { headers }),
    requestJson<{ organizations: AdminOrganization[] }>("/v1/admin/organizations", { headers }),
    requestJson<{ projects: AdminProject[] }>("/v1/admin/projects", { headers }),
    requestJson<{ events: AuditEvent[] }>("/v1/admin/audit-events?limit=20", { headers })
  ]);
  return {
    users: users.users,
    organizations: organizations.organizations,
    projects: projects.projects,
    events: events.events
  };
}

export function buildMockQuery(dataset: DatasetSummary, gene: string): QueryResponse {
  const rows = Array.from({ length: 48 }, (_, index) => {
    const group = index % 3 === 0 ? "Normal" : index % 3 === 1 ? "Tumor" : "Immune-enriched";
    return {
      sample_id: `S${String(index + 1).padStart(3, "0")}`,
      observation_id: `S${String(index + 1).padStart(3, "0")}`,
      feature_symbol: gene,
      value: Number((Math.sin(index / 5) * 1.7 + 5.2 + (group === "Tumor" ? 0.8 : 0)).toFixed(3)),
      cancer: dataset.dataset === "toil" ? "PAAD" : "demo",
      group
    };
  });
  return {
    status: "success",
    data: rows,
    meta: {
      dataset: dataset.dataset,
      version: dataset.default_version ?? "mock",
      backend: dataset.backend,
      n_rows: rows.length,
      columns: Object.keys(rows[0] ?? {}),
      elapsed_ms: 3.2,
      cached: false
    }
  };
}
