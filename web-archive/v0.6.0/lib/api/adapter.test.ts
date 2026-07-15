import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBioGraphSubgraph,
  getProjectContextPack,
  getResource,
  listProjects,
  listResources,
  submitProjectObservations,
} from "./adapter";

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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code:"not_found", message:"Resource not found", request_id:"req-42" }), { status:404, headers:{"content-type":"application/json"} })));
    await expect(getResource("private-record")).rejects.toMatchObject({ code:"not_found", message:"Resource not found", requestId:"req-42", status:404 });
  });

  it("does not invent catalog records when the live API returns none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data:[] }), { status:200, headers:{"content-type":"application/json"} })));
    const result = await listResources();
    expect(result.data).toEqual([]);
  });
});

describe("Projects and BioGraph API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes projects without browser-local fallback records", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: [{
      id: "project-1",
      name: "Tumor atlas",
      description: "Integrated dry and wet lab evidence",
      owner_user_id: "user-1",
      visibility: "private",
      status: "active",
      created_at: "2026-07-14T00:00:00Z",
      updated_at: "2026-07-14T01:00:00Z",
    }] })));
    const projects = await listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ id: "project-1", name: "Tumor atlas", visibility: "private", status: "active" });
  });

  it("maps the real context-pack arrays and does not invent summary fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: {
      project: { id: "project-1", name: "Project 1", description: "", owner_user_id: "user-1", visibility: "private", status: "active", metadata: {}, created_at: "now", updated_at: "now" },
      studies: [{ id: "study-1", name: "Study 1" }],
      entities: [{ id: "sample-1", category: "sample", kind: "tissue", label: "Sample 1", status: "active", metadata: {}, created_at: "now" }],
      activities: [{ id: "activity-1", kind: "assay", label: "qPCR", status: "completed", parameters: {}, created_at: "now" }],
      activity_io: [{ activity_id: "activity-1", entity_id: "sample-1", direction: "input", role: "sample" }],
      activity_actors: [],
      associations: [{ id: "association-1", subject_id: "sample-1", predicate: "shennong:measured_by", object_id: "observation-1", polarity: "neutral", knowledge_level: "observation", status: "validated", qualifiers: {} }],
      evidence: [{ id: "evidence-1", evidence_type: "direct_observation" }],
      association_evidence: [{ association_id: "association-1", evidence_id: "evidence-1", stance: "supporting" }],
      resources: [],
      project_resources: [],
      resource_revisions: [],
      resource_graph_bindings: [],
      truncated: true,
    } })));
    const context = await getProjectContextPack("project-1");
    expect(context.project.name).toBe("Project 1");
    expect(context.studies).toHaveLength(1);
    expect(context.entities[0]).toMatchObject({ id: "sample-1", category: "sample" });
    expect(context.activities[0]).toMatchObject({ id: "activity-1", status: "completed" });
    expect(context.associations[0]).toMatchObject({ state: "validated", polarity: "neutral" });
    expect(context.activityIo).toHaveLength(1);
    expect(context.associationEvidence).toHaveLength(1);
    expect(context.truncated).toBe(true);
    expect(context.raw).not.toHaveProperty("summary");
  });

  it("reads the bounded subgraph entities and associations contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: {
      root_entity_id: "sample-1",
      depth: 2,
      truncated: false,
      entities: [
        { id: "sample-1", category: "sample", kind: "tissue", label: "Sample 1", status: "active", metadata: {} },
        { id: "observation-1", category: "observation", kind: "ct_value", label: "Ct", status: "active", metadata: {} },
      ],
      associations: [{ id: "association-1", subject_id: "sample-1", predicate: "shennong:has_observation", object_id: "observation-1", polarity: "neutral", knowledge_level: "observation", status: "proposed", qualifiers: {} }],
    } }));
    vi.stubGlobal("fetch", fetchMock);
    const graph = await getBioGraphSubgraph("sample-1", 2, 500);
    expect(graph).toMatchObject({ root: "sample-1", depth: 2, truncated: false });
    expect(graph.nodes[1].state).toBe("observed");
    expect(graph.edges[0]).toMatchObject({ subjectId: "sample-1", objectId: "observation-1", state: "observed" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=80");
  });

  it("persists observation activity, IO, association, evidence, and evidence link as distinct API mutations", async () => {
    const requests: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      const url = String(input);
      requests.push({ url, method: init?.method ?? "GET", body });
      return jsonResponse({ data: body });
    }));
    const report = await submitProjectObservations("project-1", [{ sampleEntityId: "sample-1", measurementType: "ct_value", value: 21.4, unit: "Ct" }]);
    expect(report.complete).toBe(true);
    expect(report.activityIo).toHaveLength(1);
    expect(report.associationEvidence).toHaveLength(1);
    expect(requests.map(({ url }) => url)).toEqual([
      expect.stringMatching(/\/projects\/project-1\/activities$/),
      expect.stringMatching(/\/projects\/project-1\/entities$/),
      expect.stringMatching(/\/projects\/project-1\/activities\/activity-.*\/io$/),
      expect.stringMatching(/\/projects\/project-1\/associations$/),
      expect.stringMatching(/\/projects\/project-1\/evidence$/),
      expect.stringMatching(/\/projects\/project-1\/associations\/association-.*\/evidence\/evidence-.*/),
    ]);
    expect(requests[0].body).toMatchObject({ project_id: "project-1", kind: "observation_capture", status: "completed", parameters: { row_count: 1 } });
    expect(requests[1].body).toMatchObject({ project_id: "project-1", category: "observation", kind: "ct_value", metadata: { sample_id: "sample-1", value: 21.4, unit: "Ct" } });
    expect(requests[2].body).toMatchObject({ direction: "output", role: "observation", ordinal: 0 });
    expect(requests[3].body).toMatchObject({ subject_id: "sample-1", predicate: "shennong:has_observation", knowledge_level: "observation", polarity: "neutral", status: "proposed" });
    expect(requests[3].body).not.toHaveProperty("evidence");
    expect(requests[4].body).toMatchObject({ evidence_type: "direct_observation", source_id: expect.stringMatching(/^activity-/), statistics: { value: 21.4, unit: "Ct" } });
    expect(requests[5].body).toMatchObject({ stance: "supporting" });
  });
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
