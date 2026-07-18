import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspaceView } from "./project-workspace-view";

const mocks = vi.hoisted(() => ({
  getProjectContextPack: vi.fn(),
  listProjectEntities: vi.fn(),
  listProjectActivities: vi.fn(),
  listProjectResources: vi.fn(),
  submitProjectObservations: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/project-1", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api/adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/adapter")>("@/lib/api/adapter");
  return {
    ...actual,
    getSession: async () => ({ authenticated: true, user_id: "user-1", role: "user", scopes: [] }),
    getHealth: async () => ({ status: "ok" }),
    listIngestionJobs: async () => [],
    signOut: async () => undefined,
    getProjectContextPack: mocks.getProjectContextPack,
    listProjectEntities: mocks.listProjectEntities,
    listProjectActivities: mocks.listProjectActivities,
    listProjectResources: mocks.listProjectResources,
    submitProjectObservations: mocks.submitProjectObservations,
  };
});

describe("ProjectWorkspaceView", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.listProjectEntities.mockResolvedValue([]);
    mocks.listProjectActivities.mockResolvedValue([]);
    mocks.listProjectResources.mockResolvedValue([]);
  });

  it("renders project sections from one non-truncated context-pack request", async () => {
    mocks.getProjectContextPack.mockResolvedValue(contextPack(false));
    renderWithClient(<ProjectWorkspaceView projectId="project-1" />);
    expect(await screen.findByRole("heading", { name: "Agent context pack" })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Tumor atlas" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Study 1")).toBeInTheDocument();
    expect(screen.getByText("Sample 1")).toBeInTheDocument();
    expect(screen.getByText("qPCR capture")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("href", "/projects/project-1/chat");
    expect(screen.getByRole("link", { name: "Memory" })).toHaveAttribute("href", "/projects/project-1/memory");
    expect(mocks.getProjectContextPack).toHaveBeenCalledTimes(1);
    expect(mocks.listProjectEntities).not.toHaveBeenCalled();
    expect(mocks.listProjectActivities).not.toHaveBeenCalled();
    expect(mocks.listProjectResources).not.toHaveBeenCalled();
  });

  it("loads complete lists only after a truncated pack and explicit user action", async () => {
    const user = userEvent.setup();
    mocks.getProjectContextPack.mockResolvedValue(contextPack(true));
    renderWithClient(<ProjectWorkspaceView projectId="project-1" />);
    const button = await screen.findByRole("button", { name: "Load complete lists" });
    expect(mocks.listProjectEntities).not.toHaveBeenCalled();
    await user.click(button);
    expect(await screen.findByText("Loading full lists…")).toBeInTheDocument();
    expect(mocks.listProjectEntities).toHaveBeenCalledWith("project-1");
    expect(mocks.listProjectActivities).toHaveBeenCalledWith("project-1");
    expect(mocks.listProjectResources).toHaveBeenCalledWith("project-1");
  });
});

function contextPack(truncated: boolean) {
  return {
    projectId: "project-1",
    project: { id: "project-1", name: "Tumor atlas", description: "Integrated evidence", status: "active", visibility: "private", ownerUserId: "user-1", createdAt: "", updatedAt: "", counts: {}, raw: {} },
    studies: [{ id: "study-1", name: "Study 1", description: "Cohort study" }],
    entities: [{ id: "sample-1", label: "Sample 1", category: "sample", kind: "tissue", state: "active", properties: {}, createdAt: "", raw: {} }],
    activities: [{ id: "activity-1", label: "qPCR capture", kind: "assay", status: "completed", startedAt: "", endedAt: "", metadata: {}, raw: {} }],
    activityIo: [],
    activityActors: [],
    associations: [],
    evidence: [],
    associationEvidence: [],
    resources: [],
    projectResources: [],
    resourceRevisions: [],
    resourceGraphBindings: [],
    truncated,
    raw: {},
  };
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
