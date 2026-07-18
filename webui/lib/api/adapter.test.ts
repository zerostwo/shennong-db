import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverAiProviderModels,
  archiveAgentMemory,
  createProjectChatThread,
  createProjectMemory,
  enableThreadSkill,
  generateAgentSkill,
  getBioGraphSubgraph,
  getChatThread,
  getProjectContextPack,
  getResource,
  listAiProviders,
  listAgentSkills,
  listGlobalMemories,
  listProjectChatThreads,
  listProjects,
  listResources,
  registerUser,
  searchWorkspace,
  sendChatMessage,
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

  it("preserves a provider error string when the API uses the legacy error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "DeepSeek rejected the model request" }), { status: 502, headers: { "content-type": "application/json" } })));
    await expect(getResource("provider-error")).rejects.toMatchObject({ message: "DeepSeek rejected the model request", status: 502 });
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

describe("Agent-first API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps provider metadata without exposing or inventing an API key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: [{
      id: "provider-1",
      name: "Lab Ollama",
      provider_kind: "ollama",
      base_url: "http://host.docker.internal:11434/v1",
      model: "local-model",
      data_policy: "allow_private",
      enabled: true,
      is_default: true,
      has_api_key: false,
      updated_at: "now",
    }] })));
    const providers = await listAiProviders();
    expect(providers).toEqual([expect.objectContaining({ id: "provider-1", providerType: "ollama", model: "local-model", dataPolicy: "allow_private", isDefault: true, hasApiKey: false })]);
    expect(providers[0].raw).not.toHaveProperty("api_key");
  });

  it("loads a thread and its persisted messages from their separate endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: "chat-1", title: "TP53 analysis", provider_id: "provider-1" } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "message-1", role: "user", content: "Inspect TP53", attachments: [], tool_events: [], citations: [], created_at: "now" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const thread = await getChatThread("chat-1");
    expect(thread).toMatchObject({ id: "chat-1", title: "TP53 analysis", providerId: "provider-1" });
    expect(thread.messages).toEqual([expect.objectContaining({ id: "message-1", role: "user", content: "Inspect TP53" })]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringMatching(/\/chat\/threads\/chat-1$/),
      expect.stringMatching(/\/chat\/threads\/chat-1\/messages$/),
    ]);
  });

  it("preserves agent tool events and Resource citations from a live run", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: {
      assistant: { id: "message-2", role: "assistant", content: "TP53 is available.", created_at: "now" },
      tool_events: [{ tool: "search_resources", status: "completed", arguments: { q: "TP53" } }],
      citations: [{ type: "resource", resource_id: "toil" }],
    } }));
    vi.stubGlobal("fetch", fetchMock);
    const message = await sendChatMessage("chat-1", { content: "Find TP53", provider_id: "provider-1", upload_ids: ["upload-1"], allow_data_write: true });
    expect(message).toMatchObject({ role: "assistant", content: "TP53 is available." });
    expect(message.toolEvents[0]).toMatchObject({ name: "search_resources", status: "completed", input: { q: "TP53" } });
    expect(message.citations[0]).toMatchObject({ resourceId: "toil", label: "toil" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ provider_id: "provider-1", upload_ids: ["upload-1"], allow_data_write: true });
  });

  it("preserves reasoning, token usage, and the selected reasoning effort", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: {
      assistant: {
        id: "message-reasoning",
        role: "assistant",
        content: "**YTHDF2** is upregulated.",
        reasoning_content: "I compared tumor and normal cohorts.",
        usage: { prompt_tokens: 120, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 16 }, total_tokens: 160 },
      },
    } }));
    vi.stubGlobal("fetch", fetchMock);
    const message = await sendChatMessage("chat-1", { content: "Analyze YTHDF2", provider_id: "provider-1", reasoning_effort: "high" });
    expect(message).toMatchObject({
      reasoning: "I compared tumor and normal cohorts.",
      usage: { inputTokens: 120, outputTokens: 40, reasoningTokens: 16, totalTokens: 160 },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ reasoning_effort: "high" });
  });

  it("discovers and sorts model IDs from provider metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { models: [{ id: "deepseek-reasoner" }, { id: "deepseek-chat" }, { id: "deepseek-chat" }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const models = await discoverAiProviderModels({ provider_kind: "deepseek", base_url: "https://api.deepseek.com", api_key: "secret" });
    expect(models).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ provider_kind: "deepseek", api_key: "secret" });
  });

  it("uses a cleaned-up draft connection when model discovery is unavailable on an older server", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: "not_supported", message: "Not found" }, 404))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "provider-draft", name: "setup", provider_kind: "ollama", base_url: "http://host.docker.internal:11434/v1", model: "model-discovery" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: ["hermes-qwythos9b:latest"] }))
      .mockResolvedValueOnce(jsonResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(discoverAiProviderModels({ provider_kind: "ollama", base_url: "http://host.docker.internal:11434/v1" })).resolves.toEqual(["hermes-qwythos9b:latest"]);
    expect(fetchMock.mock.calls.map(([url], index) => `${index}:${String(url)}`)).toEqual([
      expect.stringMatching(/^0:.*\/ai\/providers\/discover$/),
      expect.stringMatching(/^1:.*\/ai\/providers$/),
      expect.stringMatching(/^2:.*\/ai\/providers\/provider-draft\/models$/),
      expect.stringMatching(/^3:.*\/ai\/providers\/provider-draft$/),
    ]);
    expect(fetchMock.mock.calls[3][1]?.method).toBe("DELETE");
  });

  it("normalizes persisted built-in, user, and generated Skills", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: [
      { id: "skill-built-in", slug: "resource-research", name: "Resource research", source_kind: "built_in", status: "active", revision: 1, content: "Inspect before querying.", is_builtin: true },
      { id: "skill-generated", slug: "colon-cancer", name: "Colon cancer analysis", source_kind: "generated", status: "draft", current_revision: 2, content: "Draft workflow" },
    ] })));
    const skills = await listAgentSkills();
    expect(skills).toEqual([
      expect.objectContaining({ id: "skill-built-in", sourceKind: "built_in", status: "active", isBuiltin: true, revision: 1 }),
      expect.objectContaining({ id: "skill-generated", sourceKind: "generated", status: "draft", isBuiltin: false, revision: 2 }),
    ]);
  });

  it("generates a persisted draft and enables an active Skill through separate APIs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: "skill-generated", slug: "colon-cancer", name: "Colon cancer", source_kind: "generated", status: "draft", revision: 1, content: "Generated workflow" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const skill = await generateAgentSkill({ goal: "Analyze colon cancer expression", constraints: ["Cite Resources"] });
    await enableThreadSkill("chat-1", "skill-active");
    expect(skill).toMatchObject({ id: "skill-generated", sourceKind: "generated", status: "draft" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ goal: "Analyze colon cancer expression", constraints: ["Cite Resources"] });
    expect(fetchMock.mock.calls[1]).toEqual([expect.stringMatching(/\/chat\/threads\/chat-1\/skills\/skill-active$/), expect.objectContaining({ method: "PUT" })]);
  });

  it("keeps global and Project memories on their scoped endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "memory-global", project_id: null, title: "Global preference", source_kind: "manual", status: "active", revision: 1, content: "Always cite Resources." }] }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "memory-project", project_id: "project-1", title: "Cohort design", source_kind: "manual", status: "active", revision: 1, content: "Tumor versus adjacent normal." } }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const global = await listGlobalMemories();
    const project = await createProjectMemory("project-1", { title: "Cohort design", content: "Tumor versus adjacent normal." });
    await archiveAgentMemory(project.id);
    expect(global[0]).toMatchObject({ id: "memory-global", projectId: "", status: "active" });
    expect(project).toMatchObject({ id: "memory-project", projectId: "project-1" });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringMatching(/\/memories$/),
      expect.stringMatching(/\/projects\/project-1\/memories$/),
      expect.stringMatching(/\/memories\/memory-project$/),
    ]);
    expect(fetchMock.mock.calls[2][1]?.method).toBe("DELETE");
  });

  it("creates and lists Project-scoped chat threads without changing global chat routes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: "thread-project", title: "YTHDF2", provider_id: "provider-1", project_id: "project-1" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "thread-project", title: "YTHDF2", provider_id: "provider-1", project_id: "project-1" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const created = await createProjectChatThread("project-1", { title: "YTHDF2", provider_id: "provider-1" });
    const listed = await listProjectChatThreads("project-1");
    expect(created).toMatchObject({ id: "thread-project", projectId: "project-1" });
    expect(listed[0]).toMatchObject({ id: "thread-project", projectId: "project-1" });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringMatching(/\/projects\/project-1\/chat\/threads$/),
      expect.stringMatching(/\/projects\/project-1\/chat\/threads$/),
    ]);
  });

  it("routes search results to their global or Project-scoped chat", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      chats: [
        { id: "thread-global", title: "Global YTHDF2" },
        { id: "thread-project", title: "Project YTHDF2", project_id: "project-1" },
      ],
    })));
    const results = await searchWorkspace("YTHDF2");
    expect(results).toEqual([
      expect.objectContaining({ id: "thread-global", href: "/chat/thread-global" }),
      expect.objectContaining({ id: "thread-project", href: "/projects/project-1/chat/thread-project" }),
    ]);
  });

  it("preserves the backend error reason when persisted failed tool events are reloaded", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: "chat-1", title: "Private Resource", provider_id: "provider-1" } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{
        id: "message-3",
        role: "assistant",
        content: "I could not inspect that Resource.",
        created_at: "now",
        tool_events: [{ tool: "inspect_resource", status: "failed", error: "Resource is private for this provider" }],
        citations: [],
      }] })));
    const thread = await getChatThread("chat-1");
    expect(thread.messages[0].toolEvents[0]).toMatchObject({
      name: "inspect_resource",
      status: "failed",
      summary: "Resource is private for this provider",
    });
  });

  it("registers an ordinary user through the public account endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { authenticated: true, user_id: "user-1", role: "user" } }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const result = await registerUser("Researcher", "researcher@example.org", "a-secure-password");
    expect(result).toMatchObject({ authenticated: true, role: "user" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ display_name: "Researcher", email: "researcher@example.org", password: "a-secure-password" });
  });
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
