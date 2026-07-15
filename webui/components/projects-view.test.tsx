import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsView } from "./projects-view";

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/projects", useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/api/adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/adapter")>("@/lib/api/adapter");
  return {
    ...actual,
    getSession: async () => ({ authenticated: true, user_id: "user-1", role: "user", scopes: [] }),
    getHealth: async () => ({ status: "ok" }),
    listIngestionJobs: async () => [],
    signOut: async () => undefined,
    listProjects: mocks.listProjects,
    createProject: mocks.createProject,
  };
});

describe("ProjectsView", () => {
  beforeEach(() => {
    mocks.listProjects.mockReset();
    mocks.createProject.mockReset();
    mocks.push.mockReset();
  });

  it("renders only projects returned by the live adapter", async () => {
    mocks.listProjects.mockResolvedValue([{ id: "project-1", name: "Tumor atlas", description: "Real project", status: "active", visibility: "private", ownerUserId: "user-1", createdAt: "", updatedAt: "", counts: {}, raw: {} }]);
    renderWithClient(<ProjectsView />);
    expect(await screen.findByRole("heading", { name: "Tumor atlas" })).toBeInTheDocument();
    expect(screen.getByText("Real project")).toBeInTheDocument();
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
  });

  it("creates a project through the adapter and navigates only after success", async () => {
    const user = userEvent.setup();
    mocks.listProjects.mockResolvedValue([]);
    mocks.createProject.mockResolvedValue({ id: "project-created", name: "Created project", description: "", status: "active", visibility: "private", ownerUserId: "user-1", createdAt: "", updatedAt: "", counts: {}, raw: {} });
    renderWithClient(<ProjectsView />);
    await screen.findByRole("heading", { name: "No projects yet" });
    await user.click(screen.getAllByRole("button", { name: "New project" })[0]);
    await user.type(screen.getByLabelText("Project name"), "Created project");
    await user.type(screen.getByLabelText("Description"), "Created from the real API");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(mocks.createProject).toHaveBeenCalled());
    expect(mocks.createProject.mock.calls[0]?.[0]).toEqual({
      name: "Created project",
      description: "Created from the real API",
      visibility: "private",
    });
    expect(mocks.push).toHaveBeenCalledWith("/projects/project-created");
  });
});

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
