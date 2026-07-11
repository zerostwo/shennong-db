import { afterEach, describe, expect, it, vi } from "vitest";
import { listResources } from "./adapter";

describe("listResources", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns only records supplied by the live API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "live-1", kind: "Resource", metadata: { title: "Live" }, permissions: { visibility: "public" }, spec: {} }] }), { status: 200, headers: { "content-type": "application/json" } })));
    const result = await listResources();
    expect(result.source).toBe("live");
    expect(result.data.map(({ id }) => id)).toEqual(["live-1"]);
    expect(result.data[0].kind).toBe("Resource");
  });
});
