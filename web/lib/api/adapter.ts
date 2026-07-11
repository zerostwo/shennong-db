export type ResourceVisibility = "Public" | "Private";
export type ResourceKind = "Resource" | "Artifact" | "Relation";

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

function toResource(value: Record<string, unknown>): ResourceRecord {
  const metadata = (value.metadata ?? {}) as Record<string, unknown>;
  const spec = (value.spec ?? {}) as Record<string, unknown>;
  const permissions = (value.permissions ?? {}) as Record<string, unknown>;
  const kind = text(value.kind, "Resource") as ResourceKind;
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

export type ApiResult<T> = { data: T; source: "live" | "fallback" };

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
export async function listUsers(): Promise<unknown[]> { return request<unknown[]>("/users"); }
export async function listAuditEvents(): Promise<unknown[]> { return request<unknown[]>("/audit-events"); }
export async function getHealth(): Promise<Record<string, unknown>> {
  const response = await fetch("/healthz", { credentials: "include", headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new ShennongApiError({ code: "health_unavailable", message: typeof payload.message === "string" ? payload.message : "Health check failed", status: response.status });
  return payload;
}

export async function issueUserToken(userId: string, expiresIn = 86_400, scopes = ["resource.read"]): Promise<{ token: string; expires_at: number }> {
  void userId;
  return request("/auth/tokens", { method: "POST", body: JSON.stringify({ expires_in: expiresIn, scopes }) });
}

export async function listUserTokens(userId: string): Promise<unknown[]> {
  return request<unknown[]>(`/users/${encodeURIComponent(userId)}/tokens`);
}

export async function revokeCurrentToken(): Promise<void> {
  await request("/auth/revoke", { method: "POST" });
}

export async function grantResource(resourceId: string, userId: string): Promise<void> {
  await request(`/resources/${encodeURIComponent(resourceId)}/grants/${encodeURIComponent(userId)}`, { method: "PUT" });
}

export async function updateUser(user: { id: string; display_name: string; email?: string; role: string; status: string }): Promise<unknown> {
  return request(`/users/${encodeURIComponent(user.id)}`, { method: "PUT", body: JSON.stringify(user) });
}

export async function signIn(email: string, password: string): Promise<{ authenticated?: boolean; requires_2fa?: boolean; challenge?: string; user_id?: string; role?: string }> {
  return request("/auth/sign-in", { method: "POST", body: JSON.stringify({ email, password }) });
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

export async function unsupported<T>(feature: string): Promise<T> {
  throw new ShennongApiError({ code: "not_supported", message: `${feature} is not supported by the current API` });
}

export const fallbackResources: ResourceRecord[] = [
  { id: "demo-toil", name: "Toil RNA-seq (Homo sapiens)", kind: "Resource", visibility: "Public", backend: "TileDB Cloud", updated: "demo", usage: "—", dataClass: "canonical", description: "Demo catalog data (API unavailable).", owner: "—", organism: "Homo sapiens", checksum: "—", source: "—", provenance: "demo fallback", size: "—" },
  { id: "demo-pbmc", name: "PBMC 3K TileDB filtered", kind: "Resource", visibility: "Private", backend: "TileDB Cloud", updated: "demo", usage: "—", dataClass: "derived", description: "Demo catalog data (API unavailable).", owner: "—", organism: "Homo sapiens", checksum: "—", source: "—", provenance: "demo fallback", size: "—" }
];

export const resources: ResourceRecord[] = [
  { id: "res_01J6ZSX4Q6RX7X9JRV2Y0HMN2N3P", name: "Toil RNA-seq (Homo sapiens)", kind: "Resource", visibility: "Public", backend: "TileDB Cloud", updated: "2 hours ago", usage: "1.2K", dataClass: "canonical", description: "Normalized RNA-seq expression (TPM) for Toil collection across human samples.", owner: "bioinfo@demo.org", organism: "Homo sapiens", checksum: "a3b7c5d5e9f12c9c6b1a2f3a4b5c6d7e", source: "s3://toil-rnaseq/processed/v2.1.0/", provenance: "ingest: toil-rnaseq-pipeline v2.1.0", size: "2.34 TB" },
  { id: "res_0JTCsNNI26Be2dVJ3S8T1NBOD4HKK", name: "PBMC 3K TileDB filtered", kind: "Resource", visibility: "Private", backend: "TileDB Cloud", updated: "1 day ago", usage: "342", dataClass: "derived", description: "Filtered PBMC 3K single-cell matrix with cell-level metadata.", owner: "researcher@demo.org", organism: "Homo sapiens", checksum: "c4d0a1b16e9a51d7b7dd1ef70bb4f5c2", source: "s3://pbmc-3k/filtered/", provenance: "ingest: pbmc-cellranger v7.2", size: "18.7 GB" },
  { id: "res_01J47TTA2AWVS0F6PL3H1KT2Q3Q", name: "TCGA survival metadata", kind: "Resource", visibility: "Public", backend: "PostgreSQL", updated: "3 days ago", usage: "980", dataClass: "canonical", description: "Curated TCGA clinical and survival metadata joined by patient identifier.", owner: "clinical@demo.org", organism: "Homo sapiens", checksum: "d8ee9a4f20b68067a6b7e31a5f8ed55a", source: "s3://tcga-clinical/survival/v4/", provenance: "ingest: tcga-clinical-normalizer v4.0", size: "6.8 GB" },
  { id: "res_01J33DE1B4FDRBGON2JLL4MSN", name: "GENCODE v44 gene map", kind: "Resource", visibility: "Public", backend: "S3", updated: "5 days ago", usage: "2.7K", dataClass: "canonical", description: "Gene, transcript, and stable identifier mapping from GENCODE release 44.", owner: "genomics@demo.org", organism: "Homo sapiens", checksum: "f7c0a2b4d9c3a1e55a7dd492d8bfe611", source: "s3://reference/gencode/v44/", provenance: "provider: gencode v44", size: "2.1 GB" },
  { id: "res_01Q2JSRW8V8C37D6P6GQ2H4J", name: "S3 raw bucket · WGS reads", kind: "Resource", visibility: "Private", backend: "AWS S3", updated: "7 days ago", usage: "156", dataClass: "raw", description: "Raw sequencing reads retained for reproducible WGS processing.", owner: "data-steward@demo.org", organism: "Homo sapiens", checksum: "9014a4e1ddf917e3debc56f3dbe09b3a", source: "s3://shennong-raw/wgs/", provenance: "upload: multipart-2025-05-12", size: "146.2 TB" },
  { id: "art_01J6ZSX4Q6RX7X9JRV2Y0HMN2N3P_v1", name: "Toil RNA-seq (Homo sapiens) v1", kind: "Artifact", visibility: "Public", backend: "TileDB Cloud", updated: "2 hours ago", usage: "1.2K", dataClass: "derived", description: "Versioned TileDB artifact for the Toil RNA-seq resource.", owner: "bioinfo@demo.org", organism: "Homo sapiens", checksum: "04e9a2cc40ee6b71ce58a6e82d39a2d3", source: "tiledb://tiledb-cloud/tiles/toil-rnaseq.b5", provenance: "derived from toil RNA-seq", size: "2.34 TB" },
  { id: "art_0JTCsNNI26Be2dVJ3S8T1NBOD4HKK_s1", name: "PBMC 3K TileDB filtered snapshot 2024-05-12", kind: "Artifact", visibility: "Private", backend: "TileDB Cloud", updated: "1 day ago", usage: "87", dataClass: "cache", description: "Immutable snapshot used by a PBMC 3K analysis workspace.", owner: "researcher@demo.org", organism: "Homo sapiens", checksum: "5b8c3d9a2c3ea2a6d5ecf67a9a9b1d03", source: "tiledb://tiledb-cloud/tiles/pbmc3k.b5", provenance: "snapshot: 2024-05-12", size: "4.3 GB" },
  { id: "rel_01J47TTA2AWVS0F6PL3H1KT2Q3Q_r1", name: "TCGA clinical → survival (view)", kind: "Relation", visibility: "Public", backend: "PostgreSQL", updated: "3 days ago", usage: "410", dataClass: "derived", description: "A relation exposing curated survival fields from TCGA clinical records.", owner: "clinical@demo.org", organism: "Homo sapiens", checksum: "relation:tcga-survival-v2", source: "postgres://catalog/relations/tcga", provenance: "relation: clinical → survival", size: "1.2 GB" },
  { id: "rel_01J33DE1B4FDRBGON2JLL4MSN_r1", name: "GENCODE gene ↔ transcript (contains)", kind: "Relation", visibility: "Public", backend: "S3", updated: "5 days ago", usage: "720", dataClass: "canonical", description: "Gene-to-transcript containment relation from GENCODE v44.", owner: "genomics@demo.org", organism: "Homo sapiens", checksum: "relation:gencode-v44", source: "s3://reference/gencode/v44/relations", provenance: "provider: gencode v44", size: "490 MB" },
  { id: "rel_01Q2JSRW8V8C37D6P6GQ2H4J_r1", name: "Sample → S3 raw bucket (stored_in)", kind: "Relation", visibility: "Private", backend: "AWS S3", updated: "7 days ago", usage: "33", dataClass: "raw", description: "Storage relation for WGS sample objects in the raw bucket.", owner: "data-steward@demo.org", organism: "Homo sapiens", checksum: "relation:wgs-raw-2025", source: "s3://shennong-raw/wgs/relations", provenance: "upload: multipart-2025-05-12", size: "92 MB" }
];

export const mockApi = { listResources: async () => resources, getResource: async (id: string) => resources.find((resource) => resource.id === id) ?? null };
