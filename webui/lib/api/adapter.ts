export type ResourceVisibility = "Public" | "Private";
export type ResourceKind = "Resource" | "Artifact" | "Relation";
export type JsonRecord = Record<string, unknown>;

export type AiProviderRecord = {
  id: string;
  name: string;
  providerType: "openai" | "deepseek" | "ollama" | "openai-compatible";
  baseUrl: string;
  model: string;
  dataPolicy: "public_only" | "allow_private";
  enabled: boolean;
  isDefault: boolean;
  hasApiKey: boolean;
  updatedAt: string;
  raw: JsonRecord;
};

export type ChatToolEvent = {
  id: string;
  name: string;
  status: string;
  summary: string;
  input?: unknown;
  output?: unknown;
};

export type ChatCitation = {
  id: string;
  label: string;
  resourceId?: string;
  locator?: string;
};

export type ChatMessageRecord = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  createdAt: string;
  attachments: JsonRecord[];
  toolEvents: ChatToolEvent[];
  citations: ChatCitation[];
  raw: JsonRecord;
};

export type ChatThreadRecord = {
  id: string;
  title: string;
  providerId: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessageRecord[];
  raw: JsonRecord;
};

export type WorkspaceSearchItem = {
  id: string;
  kind: "chat" | "resource" | "project";
  title: string;
  description: string;
  href: string;
};

export type ResourceRecord = {
  id: string;
  name: string;
  kind: ResourceKind;
  visibility: ResourceVisibility;
  backend: string;
  updated: string;
  usage: string;
  dataClass: "raw" | "canonical" | "derived" | "cache" | "staging";
  description: string;
  owner: string;
  organism: string;
  checksum: string;
  source: string;
  provenance: string;
  size: string;
  raw?: unknown;
};

export type ProjectRecord = {
  id: string;
  name: string;
  description: string;
  status: string;
  visibility: "public" | "private";
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  counts: {
    studies?: number;
    entities?: number;
    activities?: number;
    resources?: number;
  };
  raw: JsonRecord;
};

export type ProjectEntityRecord = {
  id: string;
  label: string;
  category: string;
  kind: string;
  state: string;
  properties: JsonRecord;
  createdAt: string;
  raw: JsonRecord;
};

export type ProjectActivityRecord = {
  id: string;
  label: string;
  kind: string;
  status: string;
  startedAt: string;
  endedAt: string;
  metadata: JsonRecord;
  raw: JsonRecord;
};

export type ProjectContextPack = {
  projectId: string;
  project: ProjectRecord;
  studies: JsonRecord[];
  entities: ProjectEntityRecord[];
  activities: ProjectActivityRecord[];
  activityIo: JsonRecord[];
  activityActors: JsonRecord[];
  associations: BioGraphEdge[];
  evidence: JsonRecord[];
  associationEvidence: JsonRecord[];
  resources: ResourceRecord[];
  projectResources: JsonRecord[];
  resourceRevisions: JsonRecord[];
  resourceGraphBindings: JsonRecord[];
  truncated: boolean;
  raw: JsonRecord;
};

export type BioGraphState =
  | "observed"
  | "computed"
  | "hypothesis"
  | "validated"
  | "refuted"
  | "unknown";

export type BioGraphNode = {
  id: string;
  label: string;
  kind: string;
  state: BioGraphState;
  summary: string;
  metadata: JsonRecord;
  raw: JsonRecord;
};

export type BioGraphEdge = {
  id: string;
  subjectId: string;
  predicate: string;
  objectId: string;
  state: BioGraphState;
  polarity: "positive" | "negative" | "neutral" | "mixed" | "unknown";
  qualifiers: JsonRecord;
  evidence: JsonRecord[];
  raw: JsonRecord;
};

export type BioGraphSubgraph = {
  root: string;
  depth: number;
  nodes: BioGraphNode[];
  edges: BioGraphEdge[];
  snapshotId: string;
  asOf: string;
  truncated: boolean;
  raw: JsonRecord;
};

export type ObservationDraft = {
  sampleEntityId: string;
  measurementType: string;
  value: number;
  unit: string;
};

export type ObservationSubmissionFailure = {
  phase: "activity" | "entity" | "activity_io" | "association" | "evidence" | "evidence_link";
  row: number | null;
  message: string;
};

export type ObservationSubmissionReport = {
  activity: ProjectActivityRecord | null;
  entities: ProjectEntityRecord[];
  activityIo: JsonRecord[];
  associations: JsonRecord[];
  evidence: JsonRecord[];
  associationEvidence: JsonRecord[];
  failures: ObservationSubmissionFailure[];
  complete: boolean;
};

export type ApiError = {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
  status?: number;
};

export class ShennongApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(error: ApiError) {
    super(error.message);
    this.name = "ShennongApiError";
    this.code = error.code;
    this.requestId = error.requestId;
    this.status = error.status;
    this.details = error.details;
  }
}

const API_BASE = process.env.NEXT_PUBLIC_SHENNONG_API_URL ?? "/api/v1";
const PROJECTS_PATH = "/projects";
const GRAPH_SUBGRAPH_PATH = "/graph/subgraph";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json", ...(init?.headers ?? {}) }
    });
  } catch (error) {
    throw new ShennongApiError({ code: "api_unavailable", message: error instanceof Error ? error.message : "ShennongDB API is unavailable" });
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new ShennongApiError({
      code: typeof payload.code === "string" ? payload.code : response.status === 404 ? "not_supported" : "request_failed",
      message: typeof payload.message === "string" ? payload.message : `Request failed (${response.status})`,
      requestId: typeof payload.request_id === "string" ? payload.request_id : undefined,
      details: payload.details,
      status: response.status
    });
  }
  return ("data" in payload ? payload.data : payload) as T;
}

function text(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.length ? value : fallback;
}

function formatSize(value: unknown): string {
  if (typeof value !== "number") return text(value);
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let index = -1;
  do { size /= 1024; index += 1; } while (size >= 1024 && index < units.length - 1);
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

function jsonRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(jsonRecord) : [];
}

function valueText(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.length > 0
    ? value
    : typeof value === "number"
      ? String(value)
      : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toResource(value: Record<string, unknown>): ResourceRecord {
  const metadata = (value.metadata ?? {}) as Record<string, unknown>;
  const spec = (value.spec ?? {}) as Record<string, unknown>;
  const permissions = (value.permissions ?? {}) as Record<string, unknown>;
  const apiKind = text(value.kind, "Resource");
  const kind: ResourceKind = apiKind === "Artifact" || apiKind === "Relation" ? apiKind : "Resource";
  const visibility = String(permissions.visibility ?? "private").toLowerCase() === "public" ? "Public" : "Private";
  return {
    id: text(value.id),
    name: text(metadata.title ?? metadata.name ?? value.id),
    kind,
    visibility,
    backend: text(spec.backend ?? spec.storage_backend ?? spec.storage),
    updated: text(value.updated_at),
    usage: text(metadata.usage, "0"),
    dataClass: text(spec.data_class, "canonical") as ResourceRecord["dataClass"],
    description: text(metadata.summary ?? metadata.description),
    owner: text(metadata.owner),
    organism: text(metadata.organism),
    checksum: text(value.content_sha256 ?? value.checksum),
    source: text(value.source_uri ?? spec.source_uri),
    provenance: typeof value.provenance === "string" ? value.provenance : JSON.stringify(value.provenance ?? {}),
    size: formatSize(value.size ?? spec.size),
    raw: value
  };
}

function toProject(value: JsonRecord): ProjectRecord {
  const metadata = jsonRecord(value.metadata);
  const counts = jsonRecord(value.counts);
  const visibility = String(value.visibility ?? metadata.visibility ?? "private").toLowerCase() === "public"
    ? "public"
    : "private";
  return {
    id: valueText(value.id),
    name: valueText(value.name ?? metadata.name ?? metadata.title, valueText(value.id)),
    description: valueText(value.description ?? metadata.description, ""),
    status: valueText(value.status, "unknown"),
    visibility,
    ownerUserId: valueText(value.owner_user_id ?? value.owner_id ?? metadata.owner, ""),
    createdAt: valueText(value.created_at, ""),
    updatedAt: valueText(value.updated_at, ""),
    counts: {
      studies: optionalNumber(value.study_count ?? counts.studies),
      entities: optionalNumber(value.entity_count ?? counts.entities),
      activities: optionalNumber(value.activity_count ?? counts.activities),
      resources: optionalNumber(value.resource_count ?? counts.resources),
    },
    raw: value,
  };
}

function toProjectEntity(value: JsonRecord): ProjectEntityRecord {
  const properties = jsonRecord(value.properties ?? value.metadata);
  return {
    id: valueText(value.id),
    label: valueText(value.label ?? value.name, valueText(value.id)),
    category: valueText(value.category, "entity"),
    kind: valueText(value.kind ?? value.entity_type, "unknown"),
    state: valueText(value.state ?? value.status, "unknown"),
    properties,
    createdAt: valueText(value.created_at, ""),
    raw: value,
  };
}

function toProjectActivity(value: JsonRecord): ProjectActivityRecord {
  return {
    id: valueText(value.id),
    label: valueText(value.label ?? value.name, valueText(value.id)),
    kind: valueText(value.kind ?? value.activity_type, "unknown"),
    status: valueText(value.status, "unknown"),
    startedAt: valueText(value.started_at ?? value.created_at, ""),
    endedAt: valueText(value.ended_at, ""),
    metadata: jsonRecord(value.parameters ?? value.metadata),
    raw: value,
  };
}

function toAiProvider(value: JsonRecord): AiProviderRecord {
  const providerTypeValue = valueText(value.provider_kind ?? value.provider_type ?? value.kind ?? value.type, "openai-compatible");
  const providerType = providerTypeValue === "openai" || providerTypeValue === "deepseek" || providerTypeValue === "ollama"
    ? providerTypeValue
    : "openai-compatible";
  return {
    id: valueText(value.id),
    name: valueText(value.name, providerType),
    providerType,
    baseUrl: valueText(value.base_url ?? value.endpoint, ""),
    model: valueText(value.model ?? value.model_name, ""),
    dataPolicy: value.data_policy === "allow_private" ? "allow_private" : "public_only",
    enabled: value.enabled !== false,
    isDefault: value.is_default === true || value.default === true,
    hasApiKey: value.has_api_key === true || value.api_key_configured === true,
    updatedAt: valueText(value.updated_at, ""),
    raw: value,
  };
}

function toToolEvents(value: unknown): ChatToolEvent[] {
  return recordArray(value).map((row, index) => ({
    id: valueText(row.id, `tool-${index}`),
    name: valueText(row.name ?? row.tool_name ?? row.tool, "Agent tool"),
    status: valueText(row.status, "completed"),
    summary: valueText(row.summary ?? row.message ?? row.description ?? row.error, ""),
    input: row.input ?? row.arguments,
    output: row.output ?? row.result,
  }));
}

function toCitations(value: unknown): ChatCitation[] {
  return recordArray(value).map((row, index) => {
    const resourceId = valueText(row.resource_id ?? row.resource, "");
    return {
      id: valueText(row.id, `${resourceId || "citation"}-${index}`),
      label: valueText(row.label ?? row.title ?? row.name, resourceId || `Citation ${index + 1}`),
      resourceId: resourceId || undefined,
      locator: valueText(row.locator ?? row.path ?? row.uri, "") || undefined,
    };
  });
}

function toChatMessage(value: JsonRecord): ChatMessageRecord {
  const roleValue = valueText(value.role, "assistant");
  const role = roleValue === "user" || roleValue === "tool" || roleValue === "system" ? roleValue : "assistant";
  return {
    id: valueText(value.id, mutationId("message")),
    role,
    content: valueText(value.content ?? value.text ?? value.message, ""),
    createdAt: valueText(value.created_at, new Date().toISOString()),
    attachments: recordArray(value.attachments),
    toolEvents: toToolEvents(value.tool_events ?? value.tools),
    citations: toCitations(value.citations ?? value.sources),
    raw: value,
  };
}

function toChatThread(value: JsonRecord): ChatThreadRecord {
  const thread = jsonRecord(value.thread);
  const source = Object.keys(thread).length > 0 ? thread : value;
  const messages = value.messages ?? source.messages;
  return {
    id: valueText(source.id),
    title: valueText(source.title, "New chat"),
    providerId: valueText(source.provider_id, ""),
    projectId: valueText(source.project_id, ""),
    createdAt: valueText(source.created_at, ""),
    updatedAt: valueText(source.updated_at, ""),
    messages: recordArray(messages).map(toChatMessage),
    raw: value,
  };
}

function toContextPack(value: JsonRecord, projectId: string): ProjectContextPack {
  const projectValue = jsonRecord(value.project);
  const associationRows = recordArray(value.associations);
  return {
    projectId: valueText(projectValue.id, projectId),
    project: toProject(projectValue),
    studies: recordArray(value.studies),
    entities: recordArray(value.entities).map(toProjectEntity),
    activities: recordArray(value.activities).map(toProjectActivity),
    activityIo: recordArray(value.activity_io),
    activityActors: recordArray(value.activity_actors),
    associations: associationRows.map(toGraphEdge),
    evidence: recordArray(value.evidence),
    associationEvidence: recordArray(value.association_evidence),
    resources: recordArray(value.resources).map(toResource),
    projectResources: recordArray(value.project_resources),
    resourceRevisions: recordArray(value.resource_revisions),
    resourceGraphBindings: recordArray(value.resource_graph_bindings),
    truncated: value.truncated === true,
    raw: value,
  };
}

function graphState(knowledge: unknown, status?: unknown, category?: unknown): BioGraphState {
  if (status === "validated") return "validated";
  if (status === "refuted") return "refuted";
  if (knowledge === "observation" || category === "observation") return "observed";
  if (knowledge === "prediction" || knowledge === "assertion") return "computed";
  if (knowledge === "hypothesis") return "hypothesis";
  return "unknown";
}

function toGraphNode(value: JsonRecord): BioGraphNode {
  return {
    id: valueText(value.id),
    label: valueText(value.label ?? value.name, valueText(value.id)),
    kind: valueText(value.kind ?? value.category ?? value.type, "entity"),
    state: graphState(value.knowledge_level ?? value.state, value.status, value.category),
    summary: valueText(value.summary ?? value.description, ""),
    metadata: jsonRecord(value.metadata ?? value.properties),
    raw: value,
  };
}

function toGraphEdge(value: JsonRecord, index: number): BioGraphEdge {
  const subjectId = valueText(value.subject_id ?? value.subject ?? value.source);
  const objectId = valueText(value.object_id ?? value.object ?? value.target);
  const predicate = valueText(value.predicate ?? value.type, "related_to");
  const evidenceValue = value.evidence;
  const evidence = Array.isArray(evidenceValue)
    ? recordArray(evidenceValue)
    : Object.keys(jsonRecord(evidenceValue)).length > 0
      ? [jsonRecord(evidenceValue)]
      : [];
  const polarity = value.polarity === "positive" || value.polarity === "negative" || value.polarity === "neutral" || value.polarity === "mixed"
    ? value.polarity
    : "unknown";
  return {
    id: valueText(value.id, `${subjectId}-${predicate}-${objectId}-${index}`),
    subjectId,
    predicate,
    objectId,
    state: graphState(value.knowledge_level ?? value.state, value.status),
    polarity,
    qualifiers: jsonRecord(value.qualifiers),
    evidence,
    raw: value,
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Request failed";
}

function mutationId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

export type ApiResult<T> = { data: T; source: "live" };

export async function listResources(query?: string): Promise<ApiResult<ResourceRecord[]>> {
  const params = query ? `?q=${encodeURIComponent(query)}` : "";
  return { data: (await request<Record<string, unknown>[]>(`/resources${params}`)).map(toResource), source: "live" };
}

export async function getResource(id: string): Promise<ResourceRecord> {
  return toResource(await request<Record<string, unknown>>(`/resources/${encodeURIComponent(id)}`));
}

export async function listArtifacts(resourceId: string): Promise<unknown[]> {
  return request<unknown[]>(`/resources/${encodeURIComponent(resourceId)}/artifacts`);
}

export async function listRelations(resourceId: string): Promise<unknown[]> {
  return request<unknown[]>(`/resources/${encodeURIComponent(resourceId)}/relations`);
}

export async function listProviders(): Promise<unknown[]> { return request<unknown[]>("/providers"); }
export async function installProvider(name: string): Promise<unknown> { return request("/resources/install", { method: "POST", body: JSON.stringify({ name }) }); }
export async function listUsers(): Promise<unknown[]> { return request<unknown[]>("/users"); }
export async function getUser(id: string): Promise<JsonRecord> { return request(`/users/${encodeURIComponent(id)}`); }
export async function listAdminUserSessions(id: string): Promise<JsonRecord[]> { return request(`/users/${encodeURIComponent(id)}/sessions`); }
export async function listAdminUserLoginHistory(id: string): Promise<JsonRecord[]> { return request(`/users/${encodeURIComponent(id)}/login-history`); }
export async function listAuditEvents(): Promise<unknown[]> { return request<unknown[]>("/audit-events"); }
export async function getHealth(): Promise<Record<string, unknown>> {
  const response = await fetch("/healthz", { credentials: "include", headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new ShennongApiError({ code: "health_unavailable", message: typeof payload.message === "string" ? payload.message : "Health check failed", status: response.status });
  return payload;
}
export async function getCapabilities(): Promise<JsonRecord> { return request("/capabilities"); }
export async function getPublicConfig(): Promise<JsonRecord> { return request("/public-config"); }

export async function registerUser(displayName: string, email: string, password: string): Promise<JsonRecord> {
  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ display_name: displayName, email, password }),
  });
}

export async function listAiProviders(): Promise<AiProviderRecord[]> {
  const value = await request<unknown>("/ai/providers");
  const rows = Array.isArray(value)
    ? recordArray(value)
    : recordArray(jsonRecord(value).providers ?? jsonRecord(value).items);
  return rows.map(toAiProvider);
}

export async function createAiProvider(value: {
  name: string;
  provider_kind: AiProviderRecord["providerType"];
  base_url: string;
  model: string;
  data_policy?: AiProviderRecord["dataPolicy"];
  api_key?: string;
  enabled?: boolean;
  is_default?: boolean;
}): Promise<AiProviderRecord> {
  return toAiProvider(await request<JsonRecord>("/ai/providers", {
    method: "POST",
    body: JSON.stringify(value),
  }));
}

export async function updateAiProvider(
  id: string,
  value: Partial<{
    name: string;
    provider_kind: AiProviderRecord["providerType"];
    base_url: string;
    model: string;
    data_policy: AiProviderRecord["dataPolicy"];
    api_key: string;
    enabled: boolean;
    is_default: boolean;
  }>,
): Promise<AiProviderRecord> {
  return toAiProvider(await request<JsonRecord>(`/ai/providers/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(value),
  }));
}

export async function deleteAiProvider(id: string): Promise<void> {
  await request(`/ai/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listChatThreads(): Promise<ChatThreadRecord[]> {
  const value = await request<unknown>("/chat/threads");
  const rows = Array.isArray(value)
    ? recordArray(value)
    : recordArray(jsonRecord(value).threads ?? jsonRecord(value).items);
  return rows.map(toChatThread);
}

export async function createChatThread(value: { title?: string; provider_id?: string }): Promise<ChatThreadRecord> {
  return toChatThread(await request<JsonRecord>("/chat/threads", {
    method: "POST",
    body: JSON.stringify(value),
  }));
}

export async function getChatThread(id: string): Promise<ChatThreadRecord> {
  const path = `/chat/threads/${encodeURIComponent(id)}`;
  const [thread, messageValue] = await Promise.all([
    request<JsonRecord>(path),
    request<unknown>(`${path}/messages`),
  ]);
  const messages = Array.isArray(messageValue)
    ? recordArray(messageValue)
    : recordArray(jsonRecord(messageValue).messages ?? jsonRecord(messageValue).items);
  return toChatThread({ thread, messages });
}

export async function sendChatMessage(
  threadId: string,
  value: { content: string; provider_id?: string; upload_ids?: string[]; allow_data_write?: boolean },
): Promise<ChatMessageRecord> {
  const result = await request<JsonRecord>(`/chat/threads/${encodeURIComponent(threadId)}/messages`, {
    method: "POST",
    body: JSON.stringify(value),
  });
  const assistant = jsonRecord(result.assistant);
  const message = Object.keys(assistant).length > 0 ? assistant : jsonRecord(result.message);
  const source = Object.keys(message).length > 0 ? message : result;
  const merged: JsonRecord = {
    ...source,
    role: source.role ?? "assistant",
    tool_events: source.tool_events ?? result.tool_events,
    citations: source.citations ?? result.citations,
  };
  return toChatMessage(merged);
}

export async function searchWorkspace(query: string): Promise<WorkspaceSearchItem[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  try {
    const value = await request<unknown>(`/search?q=${encodeURIComponent(normalized)}`);
    const root = jsonRecord(value);
    const rows: JsonRecord[] = Array.isArray(value)
      ? recordArray(value)
      : [
          ...recordArray(root.chats ?? root.threads).map<JsonRecord>((row) => ({ ...row, kind: "chat" })),
          ...recordArray(root.resources).map<JsonRecord>((row) => ({ ...row, kind: "resource" })),
          ...recordArray(root.projects).map<JsonRecord>((row) => ({ ...row, kind: "project" })),
          ...recordArray(root.items),
        ];
    return rows.flatMap((row) => {
      const rawKind = valueText(row.kind ?? row.type, "").toLowerCase();
      const kind: WorkspaceSearchItem["kind"] | null = rawKind.includes("chat") || rawKind.includes("thread")
        ? "chat"
        : rawKind.includes("resource")
          ? "resource"
          : rawKind.includes("project")
            ? "project"
            : null;
      const id = valueText(row.id, "");
      if (!kind || !id) return [];
      return [{
        id,
        kind,
        title: valueText(row.title ?? row.name, id),
        description: valueText(row.description ?? row.summary, ""),
        href: kind === "chat" ? `/chat/${encodeURIComponent(id)}` : kind === "resource" ? `/resources?resource=${encodeURIComponent(id)}` : `/projects/${encodeURIComponent(id)}`,
      }];
    });
  } catch (reason) {
    if (!(reason instanceof ShennongApiError) || (reason.status !== 404 && reason.status !== 401)) throw reason;
    const [resourcesResult, projectsResult, threadsResult] = await Promise.allSettled([
      listResources(normalized),
      listProjects(),
      listChatThreads(),
    ]);
    const needle = normalized.toLowerCase();
    const resources = resourcesResult.status === "fulfilled" ? resourcesResult.value.data : [];
    const projects = projectsResult.status === "fulfilled" ? projectsResult.value : [];
    const threads = threadsResult.status === "fulfilled" ? threadsResult.value : [];
    return [
      ...threads.filter((row) => row.title.toLowerCase().includes(needle)).map((row) => ({ id: row.id, kind: "chat" as const, title: row.title, description: "Chat", href: `/chat/${encodeURIComponent(row.id)}` })),
      ...resources.filter((row) => `${row.name} ${row.id} ${row.description}`.toLowerCase().includes(needle)).map((row) => ({ id: row.id, kind: "resource" as const, title: row.name, description: row.description, href: `/resources?resource=${encodeURIComponent(row.id)}` })),
      ...projects.filter((row) => `${row.name} ${row.id} ${row.description}`.toLowerCase().includes(needle)).map((row) => ({ id: row.id, kind: "project" as const, title: row.name, description: row.description, href: `/projects/${encodeURIComponent(row.id)}` })),
    ];
  }
}

export async function issueUserToken(userId: string, expiresIn = 86_400, scopes = ["resource.read"]): Promise<{ token: string; expires_at: number; token_id: string }> {
  void userId;
  return request("/auth/tokens", { method: "POST", body: JSON.stringify({ expires_in: expiresIn, scopes }) });
}

export async function listUserTokens(userId: string): Promise<unknown[]> {
  void userId;
  return request<unknown[]>("/auth/tokens");
}
export async function listAdminUserTokens(userId: string): Promise<JsonRecord[]> { return request(`/users/${encodeURIComponent(userId)}/tokens`); }
export async function revokeOwnToken(tokenId: string): Promise<void> { await request(`/auth/tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" }); }

export async function revokeCurrentToken(): Promise<void> {
  await request("/auth/revoke", { method: "POST" });
}

export async function grantResource(resourceId: string, userId: string): Promise<void> {
  await request(`/resources/${encodeURIComponent(resourceId)}/grants/${encodeURIComponent(userId)}`, { method: "PUT" });
}

export async function updateUser(user: { id: string; display_name: string; email?: string; role: string; status: string; password?: string }): Promise<unknown> {
  return request(`/users/${encodeURIComponent(user.id)}`, { method: "PUT", body: JSON.stringify(user) });
}

export async function signIn(email: string, password: string): Promise<{ authenticated?: boolean; requires_2fa?: boolean; challenge?: string; user_id?: string; role?: string }> {
  return request("/auth/sign-in", { method: "POST", body: JSON.stringify({ email, password }) });
}

export async function getSetupStatus(): Promise<{ needs_setup: boolean }> { return request("/setup/status"); }
export async function setupAdmin(display_name: string, email: string, password: string): Promise<unknown> {
  return request("/setup/admin", { method: "POST", body: JSON.stringify({ display_name, email, password }) });
}

export async function verify2fa(challenge: string, code: string): Promise<{ authenticated: boolean; user_id: string; role: string }> {
  return request("/auth/verify-2fa", { method: "POST", body: JSON.stringify({ challenge, code }) });
}

export async function signOut(): Promise<void> {
  await request("/auth/sign-out", { method: "POST" });
}

export async function getSession(): Promise<{ authenticated: boolean; user_id: string; role: string; scopes: string[] }> {
  return request("/auth/session");
}

export async function listGrants(): Promise<JsonRecord[]> { return request("/grants"); }
export async function createGrant(value: JsonRecord): Promise<JsonRecord> { return request("/grants", { method: "POST", body: JSON.stringify(value) }); }
export async function deleteGrant(resourceId: string, userId: string): Promise<void> { await request(`/grants/${encodeURIComponent(resourceId)}/${encodeURIComponent(userId)}`, { method: "DELETE" }); }
export async function listIngestionJobs(): Promise<JsonRecord[]> { return request("/ingestion-jobs"); }
export async function listAllTokens(): Promise<JsonRecord[]> { return request("/admin/tokens"); }
export async function revokeToken(tokenId: string): Promise<void> { await request(`/admin/tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" }); }
export async function listCollections(): Promise<JsonRecord[]> { return request("/collections"); }
export async function createCollection(value: { name: string; description: string; visibility: "public" | "private" }): Promise<JsonRecord> { return request("/collections", { method: "POST", body: JSON.stringify(value) }); }
export async function deleteCollection(id: string): Promise<void> { await request(`/collections/${encodeURIComponent(id)}`, { method: "DELETE" }); }
export async function setCollectionResource(collectionId: string, resourceId: string, add: boolean): Promise<void> { await request(`/collections/${encodeURIComponent(collectionId)}/resources/${encodeURIComponent(resourceId)}`, { method: add ? "PUT" : "DELETE" }); }
export async function listFavorites(): Promise<JsonRecord[]> { return request("/favorites"); }
export async function setFavorite(resourceId: string, favorite: boolean): Promise<void> { await request(`/favorites/${encodeURIComponent(resourceId)}`, { method: favorite ? "PUT" : "DELETE" }); }
export async function listUploads(): Promise<JsonRecord[]> { return request("/uploads"); }
export async function uploadFile(file: File): Promise<JsonRecord> {
  const response = await fetch(`${API_BASE}/uploads`, { method: "POST", credentials: "include", headers: { "content-type": file.type || "application/octet-stream", "x-filename": file.name }, body: file });
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new ShennongApiError({ code: String(payload.code ?? "upload_failed"), message: String(payload.message ?? `Upload failed (${response.status})`), status: response.status });
  return ("data" in payload ? payload.data : payload) as JsonRecord;
}
export async function registerUploads(value: JsonRecord): Promise<JsonRecord> { return request("/uploads/register", { method: "POST", body: JSON.stringify(value) }); }
export async function registerProjectUploads(projectId: string, value: JsonRecord): Promise<JsonRecord> {
  return registerUploads({ ...value, project_id: projectId });
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return (await request<JsonRecord[]>(PROJECTS_PATH)).map(toProject);
}

export async function createProject(value: { name: string; description: string; visibility: "public" | "private" }): Promise<ProjectRecord> {
  return toProject(await request<JsonRecord>(PROJECTS_PATH, { method: "POST", body: JSON.stringify({ id: mutationId("project"), ...value }) }));
}

export async function getProject(projectId: string): Promise<ProjectRecord> {
  return toProject(await request<JsonRecord>(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}`));
}

export async function getProjectContextPack(projectId: string): Promise<ProjectContextPack> {
  const value = await request<JsonRecord>(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}/context-pack`);
  return toContextPack(value, projectId);
}

export async function listProjectEntities(projectId: string): Promise<ProjectEntityRecord[]> {
  return (await request<JsonRecord[]>(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}/entities`)).map(toProjectEntity);
}

export async function listProjectActivities(projectId: string): Promise<ProjectActivityRecord[]> {
  return (await request<JsonRecord[]>(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}/activities`)).map(toProjectActivity);
}

export async function listProjectResources(projectId: string): Promise<ResourceRecord[]> {
  const rows = await request<JsonRecord[]>(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}/resources`);
  return rows.map((row) => toResource(jsonRecord(row.resource ?? row)));
}

export async function createProjectEntity(projectId: string, value: JsonRecord): Promise<ProjectEntityRecord> {
  return toProjectEntity(await request<JsonRecord>(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}/entities`, {
    method: "POST",
    body: JSON.stringify({ id: mutationId("entity"), project_id: projectId, ...value }),
  }));
}

export async function createProjectActivity(projectId: string, value: JsonRecord): Promise<ProjectActivityRecord> {
  return toProjectActivity(await request<JsonRecord>(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}/activities`, {
    method: "POST",
    body: JSON.stringify({ id: mutationId("activity"), project_id: projectId, ...value }),
  }));
}

export async function createProjectActivityIo(projectId: string, activityId: string, value: JsonRecord): Promise<JsonRecord> {
  return request(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}/activities/${encodeURIComponent(activityId)}/io`, {
    method: "POST",
    body: JSON.stringify({ activity_id: activityId, ...value }),
  });
}

export async function createProjectAssociation(projectId: string, value: JsonRecord): Promise<JsonRecord> {
  return request(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}/associations`, {
    method: "POST",
    body: JSON.stringify({ id: mutationId("association"), project_id: projectId, scope: "project", ...value }),
  });
}

export async function createProjectEvidence(projectId: string, value: JsonRecord): Promise<JsonRecord> {
  return request(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}/evidence`, {
    method: "POST",
    body: JSON.stringify({ id: mutationId("evidence"), project_id: projectId, ...value }),
  });
}

export async function listProjectAssociationEvidence(projectId: string, associationId: string): Promise<JsonRecord[]> {
  return request(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}/associations/${encodeURIComponent(associationId)}/evidence`);
}

export async function setProjectAssociationEvidence(
  projectId: string,
  associationId: string,
  evidenceId: string,
  value: { stance: "supporting" | "contradicting" | "neutral"; weight?: number; note?: string },
): Promise<JsonRecord> {
  return request(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}/associations/${encodeURIComponent(associationId)}/evidence/${encodeURIComponent(evidenceId)}`, {
    method: "PUT",
    body: JSON.stringify(value),
  });
}

export async function setProjectResource(projectId: string, resourceId: string, add: boolean): Promise<void> {
  await request(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceId)}`, { method: add ? "PUT" : "DELETE" });
}

export async function getBioGraphSubgraph(root: string, depth = 1, limit = 80): Promise<BioGraphSubgraph> {
  const params = new URLSearchParams({ root, depth: String(Math.min(3, Math.max(1, depth))), limit: String(Math.min(80, Math.max(1, limit))) });
  const value = await request<JsonRecord>(`${GRAPH_SUBGRAPH_PATH}?${params}`);
  const graph = jsonRecord(value.graph);
  const nodes = recordArray(value.entities ?? value.nodes ?? graph.entities ?? graph.nodes).map(toGraphNode);
  const edgeRows = recordArray(value.edges ?? value.associations ?? graph.edges ?? graph.associations);
  return {
    root: valueText(value.root_entity_id ?? value.root, root),
    depth: optionalNumber(value.depth) ?? depth,
    nodes,
    edges: edgeRows.map(toGraphEdge),
    snapshotId: valueText(value.graph_snapshot_id ?? value.snapshot_id, ""),
    asOf: valueText(value.as_of, ""),
    truncated: value.truncated === true,
    raw: value,
  };
}

export async function getResourceGraphContext(resourceId: string): Promise<JsonRecord> {
  return request(`/resources/${encodeURIComponent(resourceId)}/graph-context`);
}

export async function submitProjectObservations(projectId: string, rows: ObservationDraft[]): Promise<ObservationSubmissionReport> {
  const failures: ObservationSubmissionFailure[] = [];
  let activity: ProjectActivityRecord | null = null;
  try {
    activity = await createProjectActivity(projectId, {
      kind: "observation_capture",
      label: `Structured observation capture (${rows.length} rows)`,
      status: "completed",
      parameters: { source: "webui", row_count: rows.length },
      provenance: { actor_type: "user", interface: "webui" },
    });
  } catch (reason) {
    failures.push({ phase: "activity", row: null, message: errorMessage(reason) });
    return { activity, entities: [], activityIo: [], associations: [], evidence: [], associationEvidence: [], failures, complete: false };
  }

  const entityResults = await Promise.allSettled(rows.map((row) => createProjectEntity(projectId, {
    category: "observation",
    kind: row.measurementType,
    label: `${row.sampleEntityId} · ${row.measurementType}`,
    metadata: {
      sample_id: row.sampleEntityId,
      value: row.value,
      unit: row.unit,
    },
    provenance: { activity_id: activity.id, interface: "webui" },
  })));
  const created: Array<{ entity: ProjectEntityRecord; row: ObservationDraft; rowIndex: number }> = [];
  entityResults.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value.id !== "—") {
      created.push({ entity: result.value, row: rows[index], rowIndex: index });
    } else {
      failures.push({
        phase: "entity",
        row: index,
        message: result.status === "rejected" ? errorMessage(result.reason) : "Entity response did not contain an id",
      });
    }
  });

  const ioResults = await Promise.allSettled(created.map(({ entity, rowIndex }) => createProjectActivityIo(projectId, activity.id, {
    entity_id: entity.id,
    direction: "output",
    role: "observation",
    ordinal: rowIndex,
    metadata: { row_index: rowIndex },
  })));
  const linked: Array<{ entity: ProjectEntityRecord; row: ObservationDraft; rowIndex: number }> = [];
  const activityIo: JsonRecord[] = [];
  ioResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      activityIo.push(result.value);
      linked.push(created[index]);
    } else {
      failures.push({ phase: "activity_io", row: created[index].rowIndex, message: errorMessage(result.reason) });
    }
  });

  const associationResults = await Promise.allSettled(linked.map(({ entity, row }) => createProjectAssociation(projectId, {
    subject_id: row.sampleEntityId,
    predicate: "shennong:has_observation",
    object_id: entity.id,
    qualifiers: { measurement_type: row.measurementType, unit: row.unit },
    knowledge_level: "observation",
    polarity: "neutral",
    status: "proposed",
    provenance: { activity_id: activity.id, interface: "webui" },
  })));
  const associations: Array<{ association: JsonRecord; row: ObservationDraft; rowIndex: number }> = [];
  associationResults.forEach((result, index) => {
    if (result.status === "fulfilled" && typeof result.value.id === "string") {
      associations.push({ association: result.value, row: linked[index].row, rowIndex: linked[index].rowIndex });
    } else {
      failures.push({
        phase: "association",
        row: linked[index].rowIndex,
        message: result.status === "rejected" ? errorMessage(result.reason) : "Association response did not contain an id",
      });
    }
  });

  const evidenceResults = await Promise.allSettled(associations.map(({ association, row }) => createProjectEvidence(projectId, {
    evidence_type: "direct_observation",
    source_id: activity.id,
    locator: {
      activity_id: activity.id,
      observation_entity_id: association.object_id,
      sample_entity_id: row.sampleEntityId,
    },
    statistics: { value: row.value, unit: row.unit },
    provenance: { interface: "webui" },
  })));
  const evidence: Array<{ item: JsonRecord; association: JsonRecord; rowIndex: number }> = [];
  evidenceResults.forEach((result, index) => {
    if (result.status === "fulfilled" && typeof result.value.id === "string") {
      evidence.push({ item: result.value, association: associations[index].association, rowIndex: associations[index].rowIndex });
    } else {
      failures.push({
        phase: "evidence",
        row: associations[index].rowIndex,
        message: result.status === "rejected" ? errorMessage(result.reason) : "Evidence response did not contain an id",
      });
    }
  });

  const linkResults = await Promise.allSettled(evidence.map(({ item, association }) => setProjectAssociationEvidence(
    projectId,
    String(association.id),
    String(item.id),
    { stance: "supporting", note: `Captured by activity ${activity.id}` },
  )));
  const associationEvidence: JsonRecord[] = [];
  linkResults.forEach((result, index) => {
    if (result.status === "fulfilled") associationEvidence.push(result.value);
    else failures.push({ phase: "evidence_link", row: evidence[index].rowIndex, message: errorMessage(result.reason) });
  });

  return {
    activity,
    entities: created.map(({ entity }) => entity),
    activityIo,
    associations: associations.map(({ association }) => association),
    evidence: evidence.map(({ item }) => item),
    associationEvidence,
    failures,
    complete: failures.length === 0 && associationEvidence.length === rows.length,
  };
}
export async function getSettings(): Promise<JsonRecord> { return request("/settings"); }
export async function updateSetting(key: string, value: JsonRecord): Promise<JsonRecord> { return request(`/settings/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(value) }); }
export async function listBackups(): Promise<JsonRecord[]> { return request("/backups"); }
export async function createBackup(kind: "metadata" | "full" = "metadata"): Promise<JsonRecord> { return request("/backups", { method: "POST", body: JSON.stringify({ kind }) }); }
export async function restoreBackup(id: string): Promise<void> { await request(`/backups/${encodeURIComponent(id)}/restore`, { method: "POST" }); }
export async function getUsage(days = 30): Promise<JsonRecord> { return request(`/usage?days=${days}`); }
export async function getAdminOverview(): Promise<JsonRecord> { return request("/admin/overview"); }
export async function getStorageSummary(): Promise<JsonRecord> { return request("/storage"); }
export async function listSessions(): Promise<JsonRecord[]> { return request("/auth/sessions"); }
export async function revokeSession(tokenId: string): Promise<void> { await request(`/auth/sessions/${encodeURIComponent(tokenId)}`, { method: "DELETE" }); }
export async function listLoginHistory(): Promise<JsonRecord[]> { return request("/auth/login-history"); }
export async function getProfile(): Promise<JsonRecord> { return request("/auth/profile"); }
export async function updateProfile(value: JsonRecord): Promise<JsonRecord> { return request("/auth/profile", { method: "PUT", body: JSON.stringify(value) }); }
export async function changePassword(current_password: string, new_password: string): Promise<void> { await request("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password, new_password }) }); }
export async function getTwoFactorStatus(): Promise<{ enabled: boolean; recovery_codes_remaining: number }> { return request("/auth/2fa"); }
export async function enrollTwoFactor(): Promise<{ secret: string; otpauth_uri: string; expires_in: number }> { return request("/auth/2fa/enroll", { method: "POST" }); }
export async function confirmTwoFactor(code: string): Promise<{ enabled: boolean; recovery_codes: string[] }> { return request("/auth/2fa/confirm", { method: "POST", body: JSON.stringify({ code }) }); }
export async function disableTwoFactor(password: string): Promise<void> { await request("/auth/2fa", { method: "DELETE", body: JSON.stringify({ password }) }); }
export async function forgotPassword(email: string): Promise<JsonRecord> { return request("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }); }
export async function resetPassword(token: string, new_password: string): Promise<void> { await request("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, new_password }) }); }
export async function verifyRecoveryCode(challenge: string, code: string): Promise<JsonRecord> { return request("/auth/recovery-code", { method: "POST", body: JSON.stringify({ challenge, code }) }); }
