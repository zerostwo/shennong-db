import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./server";

const api = "http://localhost/api/v1";

describe("MSW integration contract", () => {
  it("serves a consistent public catalog and keeps private ids undisclosed", async () => {
    const catalog = await fetch(`${api}/resources`).then((response) => response.json());
    expect(catalog.data).toHaveLength(3);
    expect(catalog.data.every((resource: { permissions: { visibility: string } }) => resource.permissions.visibility === "public")).toBe(true);
    const missing = await fetch(`${api}/resources/not-authorized`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ code: "not_found", message: "Resource not found" });
  });

  it("supports token, upload, user-disable, and settings mutations", async () => {
    const token = await fetch(`${api}/auth/tokens`, { method: "POST" }).then((response) => response.json());
    expect(token.data.token).toBe("sndb_demo_secret_copy_once");
    expect((await fetch(`${api}/users/maya/tokens/tok-1`, { method: "DELETE" })).status).toBe(204);
    const upload = await fetch(`${api}/uploads`, { method: "POST", body: JSON.stringify({ name: "PBMC snapshot" }) }).then((response) => response.json());
    expect(upload.data).toMatchObject({ name: "PBMC snapshot", status: "uploading" });
    const disabled = await fetch(`${api}/users/maya/status`, { method: "PATCH", body: JSON.stringify({ status: "disabled" }) }).then((response) => response.json());
    expect(disabled.data.status).toBe("disabled");
    const settings = await fetch(`${api}/admin/settings`, { method: "PUT", body: JSON.stringify({ instance_name: "ShennongDB Research" }) }).then((response) => response.json());
    expect(settings.data.instance_name).toBe("ShennongDB Research");
  });

  it("exposes deterministic empty and failure states for UI tests", async () => {
    server.use(http.get("*/api/v1/resources", () => HttpResponse.json({ data: [] })));
    expect((await fetch(`${api}/resources`).then((response) => response.json())).data).toEqual([]);
    server.use(http.get("*/api/v1/resources", () => HttpResponse.json({ code: "catalog_unavailable", message: "Catalog is temporarily unavailable" }, { status: 503 })));
    const failed = await fetch(`${api}/resources`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ code: "catalog_unavailable" });
  });
});
