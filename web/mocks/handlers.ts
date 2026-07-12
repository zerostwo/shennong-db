import { delay, http, HttpResponse } from "msw";

const resources = [
  { id: "toil", kind: "Resource", updated_at: "2026-07-12", size: 8_912_680_550, content_sha256: "7a8a2c04d6dca541c18bcf874f1c2457d6e18638cd7d9477cb42ba55e33618ef", source_uri: "s3://shennong-public/toil", metadata: { title: "Toil RNA-seq (Homo sapiens)", owner: "data-stewards", organism: "Homo sapiens", usage: "1.12M", description: "Uniformly processed expression matrices from the TCGA Toil recompute." }, permissions: { visibility: "public" }, spec: { backend: "TileDB", data_class: "canonical" }, provenance: "provider manifest · verified" },
  { id: "tcga-survival", kind: "Resource", updated_at: "2026-07-11", size: 86_220_800, content_sha256: "638b8c897c68f701d6d1296f8d46df6833fc466caf43681d76dc0e85df0bbd8e", source_uri: "postgresql://catalog/tcga_survival", metadata: { title: "TCGA survival metadata", owner: "data-stewards", organism: "Homo sapiens", usage: "388K", description: "Curated clinical endpoints and survival outcomes." }, permissions: { visibility: "public" }, spec: { backend: "PostgreSQL", data_class: "canonical" }, provenance: "TCGA provider · verified" },
  { id: "gencode-v44", kind: "Artifact", updated_at: "2026-07-08", size: 2_998_400_000, content_sha256: "5939b87237ea52f62de81c195bedc40726bcbaf6f8b8e06b92d00496cb720ee0", source_uri: "s3://shennong-public/gencode-v44", metadata: { title: "GENCODE v44 gene map", owner: "data-stewards", organism: "Homo sapiens", usage: "92K", description: "GENCODE v44 gene-to-transcript annotations." }, permissions: { visibility: "public" }, spec: { backend: "ClickHouse", data_class: "canonical" }, provenance: "GENCODE manifest · verified" },
];
const privateResource = { id: "pbmc-3k", kind: "Resource", updated_at: "2026-07-12", size: 4_800_000_000, content_sha256: "b89316e281c6968f81e2ad81f72ce71e08ebf56f4c26819bae51e7345e7c5141", source_uri: "tiledb://shennong-private/pbmc-3k", metadata: { title: "PBMC 3K TileDB filtered", owner: "maya-chen", organism: "Homo sapiens", usage: "632K", description: "Grant-protected single-cell expression matrix." }, permissions: { visibility: "private" }, spec: { backend: "TileDB", data_class: "derived" }, provenance: "Cell Ranger 9.0.1 · verified" };

export const handlers = [
  http.get("*/api/v1/resources", async () => { await delay(120); return HttpResponse.json({ data: resources }); }),
  http.get("*/api/v1/resources/:id", ({ params }) => {
    const resource = [...resources, privateResource].find((item) => item.id === params.id);
    return resource ? HttpResponse.json({ data: resource }) : HttpResponse.json({ code: "not_found", message: "Resource not found" }, { status: 404 });
  }),
  http.get("*/api/v1/resources/:id/artifacts", () => HttpResponse.json({ data: [] })),
  http.get("*/api/v1/resources/:id/relations", () => HttpResponse.json({ data: [] })),
  http.get("*/api/v1/auth/session", ({ request }) => {
    const source = request.referrer || request.headers.get("referer") || "http://localhost";
    const role = new URL(source).searchParams.get("demoRole") ?? "admin";
    return HttpResponse.json({ data: role === "guest" ? { authenticated: false, user_id: "", role: "", scopes: [] } : { authenticated: true, user_id: role === "user" ? "elias-morgan" : "maya-chen", role, scopes: ["resource.read", "query.execute"] } });
  }),
  http.post("*/api/v1/auth/tokens", async () => { await delay(80); return HttpResponse.json({ data: { token: "sndb_demo_secret_copy_once", expires_at: 1893456000 } }); }),
  http.get("*/api/v1/users/:id/tokens", () => HttpResponse.json({ data: [] })),
  http.delete("*/api/v1/users/:userId/tokens/:tokenId", () => new HttpResponse(null, { status: 204 })),
  http.post("*/api/v1/uploads", async ({ request }) => HttpResponse.json({ data: { id: "upl-demo", status: "uploading", ...(await request.json() as object) } }, { status: 201 })),
  http.patch("*/api/v1/users/:id/status", async ({ request }) => HttpResponse.json({ data: await request.json() })),
  http.put("*/api/v1/admin/settings", async ({ request }) => HttpResponse.json({ data: await request.json() })),
  http.post("*/api/v1/auth/revoke", () => new HttpResponse(null, { status: 204 })),
  http.put("*/api/v1/resources/:resourceId/grants/:userId", () => new HttpResponse(null, { status: 204 })),
  http.put("*/api/v1/users/:id", async ({ request }) => HttpResponse.json({ data: await request.json() })),
  http.post("*/api/v1/auth/sign-in", () => HttpResponse.json({ data: { requires_2fa: true, challenge: "challenge-demo" } })),
  http.post("*/api/v1/auth/verify-2fa", () => HttpResponse.json({ data: { authenticated: true, user_id: "maya-chen", role: "admin" } })),
  http.post("*/api/v1/auth/sign-out", () => new HttpResponse(null, { status: 204 })),
  http.get("*/healthz", () => HttpResponse.json({ status: "ok", services: { postgres: "ok", clickhouse: "ok", tiledb: "ok" } })),
];
