import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryManager } from "./memory-manager";

const mocks = vi.hoisted(() => ({
  listGlobalMemories: vi.fn(),
  listProjectMemories: vi.fn(),
  archiveAgentMemory: vi.fn(),
}));

vi.mock("@/lib/api/adapter", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/adapter")>("@/lib/api/adapter")),
  listGlobalMemories: mocks.listGlobalMemories,
  listProjectMemories: mocks.listProjectMemories,
  archiveAgentMemory: mocks.archiveAgentMemory,
}));

describe("MemoryManager", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.listGlobalMemories.mockResolvedValue([memory("memory-global", "")]);
    mocks.listProjectMemories.mockResolvedValue([memory("memory-project", "project-1")]);
    mocks.archiveAgentMemory.mockResolvedValue(undefined);
  });

  it("loads only the requested scope and archives through the persisted API", async () => {
    const user = userEvent.setup();
    render(<MemoryManager projectId="project-1" />);
    expect(await screen.findByText("Cohort design")).toBeInTheDocument();
    expect(mocks.listProjectMemories).toHaveBeenCalledWith("project-1");
    expect(mocks.listGlobalMemories).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Archive Cohort design" }));
    expect(mocks.archiveAgentMemory).toHaveBeenCalledWith("memory-project");
  });
});

function memory(id: string, projectId: string) {
  return { id, projectId, title: "Cohort design", sourceKind: "manual" as const, sourceId: "", status: "active" as const, revision: 1, content: "Use **tumor versus normal** cohorts.", createdAt: "", updatedAt: "", raw: {} };
}
