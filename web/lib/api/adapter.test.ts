import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { getResource, listResources } from "./adapter";
import { server } from "@/mocks/server";

describe("listResources", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns only records supplied by the live API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "live-1", kind: "Resource", metadata: { title: "Live" }, permissions: { visibility: "public" }, spec: {} }] }), { status: 200, headers: { "content-type": "application/json" } })));
    const result = await listResources();
    expect(result.source).toBe("live");
    expect(result.data.map(({ id }) => id)).toEqual(["live-1"]);
    expect(result.data[0].kind).toBe("Resource");
  });

  it("normalizes API failures without exposing server internals", async () => {
    server.use(http.get("*/api/v1/resources/private-record", () => HttpResponse.json({ code:"not_found", message:"Resource not found", request_id:"req-42" }, { status:404 })));
    await expect(getResource("private-record")).rejects.toMatchObject({ code:"not_found", message:"Resource not found", requestId:"req-42", status:404 });
  });

  it("uses the MSW catalog contract", async () => {
    const result = await listResources();
    expect(result.data[0]).toMatchObject({ id:"toil", visibility:"Public", backend:"TileDB" });
  });
});
