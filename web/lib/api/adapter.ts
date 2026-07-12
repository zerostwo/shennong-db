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

export type JsonRecord = Record<string, unknown>;
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
