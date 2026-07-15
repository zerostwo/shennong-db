import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectGraphView } from "./project-graph-view";

const mocks = vi.hoisted(() => ({
  getProjectContextPack: vi.fn(),
  getBioGraphSubgraph: vi.fn(),
  listProjectAssociationEvidence: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/project-1/graph", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/dynamic", () => ({
  default: () => function GraphCanvasMock({ graph, onSelectEdge }: { graph: { edges: unknown[] }; onSelectEdge: (edge: unknown) => void }) {
    return <button type="button" onClick={() => onSelectEdge(graph.edges[0])}>Select canvas edge</button>;
  },
}));
vi.mock("@/lib/api/adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/adapter")>("@/lib/api/adapter");
  return {
    ...actual,
    getSession: async () => ({ authenticated: true, user_id: "user-1", role: "user", scopes: [] }),
    getHealth: async () => ({ status: "ok" }),
    listIngestionJobs: async () => [],
    signOut: async () => undefined,
    getProjectContextPack: mocks.getProjectContextPack,
    getBioGraphSubgraph: mocks.getBioGraphSubgraph,
    listProjectAssociationEvidence: mocks.listProjectAssociationEvidence,
  };
});

describe("ProjectGraphView", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getProjectContextPack.mockResolvedValue(contextPack());
    mocks.getBioGraphSubgraph.mockResolvedValue(subgraph());
    mocks.listProjectAssociationEvidence.mockResolvedValue([
      {
        evidence: { id: "evidence-1", evidence_type: "qPCR", statistics: { p_value: 0.01 } },
        association_evidence: { stance: "supporting" },
      },
    ]);
  });

  it("requests a bounded 1–3 hop graph and fetches evidence for the selected association", async () => {
    const user = userEvent.setup();
    renderWithClient(<ProjectGraphView projectId="project-1" />);

    expect(await screen.findByText("sample-1", { selector: ".graph-panel-meta code" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getBioGraphSubgraph).toHaveBeenCalledWith("sample-1", 1, 80));

    await user.selectOptions(screen.getByLabelText("Graph depth"), "3");
    await waitFor(() => expect(mocks.getBioGraphSubgraph).toHaveBeenCalledWith("sample-1", 3, 80));

    await user.click(screen.getByRole("button", { name: /measured_as/ }));
    expect(await screen.findByRole("dialog", { name: "Association evidence" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.listProjectAssociationEvidence).toHaveBeenCalledWith("project-1", "association-1"));
    expect(await screen.findByText("qPCR")).toBeInTheDocument();
    expect(screen.getByText("supporting")).toBeInTheDocument();
  });
});

function contextPack() {
  return {
    projectId: "project-1",
    project: { id: "project-1", name: "Tumor atlas", description: "", status: "active", visibility: "private", ownerUserId: "user-1", createdAt: "", updatedAt: "", counts: {}, raw: {} },
    studies: [],
    entities: [{ id: "sample-1", label: "Sample 1", category: "sample", kind: "tissue", state: "observed", properties: {}, createdAt: "", raw: {} }],
    activities: [], activityIo: [], activityActors: [], associations: [], evidence: [], associationEvidence: [], resources: [], projectResources: [], resourceRevisions: [], resourceGraphBindings: [], truncated: false, raw: {},
  };
}

function subgraph() {
  return {
    root: "sample-1",
    depth: 1,
    nodes: [
      { id: "sample-1", label: "Sample 1", kind: "sample", state: "observed", summary: "", metadata: {}, raw: {} },
      { id: "observation-1", label: "Ct 19.4", kind: "ct_value", state: "observed", summary: "", metadata: {}, raw: {} },
    ],
    edges: [{ id: "association-1", subjectId: "sample-1", predicate: "measured_as", objectId: "observation-1", state: "observed", polarity: "neutral", qualifiers: {}, evidence: [], raw: {} }],
    snapshotId: "snapshot-1", asOf: "", truncated: false, raw: {},
  };
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
