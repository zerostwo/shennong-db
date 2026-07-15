import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectObservationTable } from "./project-observation-table";

const mocks = vi.hoisted(() => ({
  submitProjectObservations: vi.fn(),
}));

vi.mock("@/lib/api/adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/adapter")>("@/lib/api/adapter");
  return { ...actual, submitProjectObservations: mocks.submitProjectObservations };
});

describe("ProjectObservationTable", () => {
  beforeEach(() => mocks.submitProjectObservations.mockReset());

  it("reports success only when the full observation evidence chain persisted", async () => {
    const user = userEvent.setup();
    mocks.submitProjectObservations.mockResolvedValue(report(true));
    renderWithClient(<ProjectObservationTable projectId="project-1" />);

    await fillFirstRow(user);
    await user.click(screen.getByRole("button", { name: "Record observations" }));

    await waitFor(() => expect(mocks.submitProjectObservations).toHaveBeenCalled());
    expect(mocks.submitProjectObservations.mock.calls[0]?.[0]).toBe("project-1");
    expect(mocks.submitProjectObservations.mock.calls[0]?.[1]).toEqual([
      { sampleEntityId: "sample-1", measurementType: "ct_value", value: 19.4, unit: "Ct" },
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent("Observation batch persisted with evidence");
    expect(screen.getByLabelText("Row 1 sample or entity ID")).toHaveValue("");
  });

  it("keeps entered rows and exposes the failed phase after a partial write", async () => {
    const user = userEvent.setup();
    mocks.submitProjectObservations.mockResolvedValue({
      ...report(false),
      failures: [{ phase: "evidence_link", row: 0, message: "link rejected" }],
    });
    renderWithClient(<ProjectObservationTable projectId="project-1" />);

    await fillFirstRow(user);
    await user.click(screen.getByRole("button", { name: "Record observations" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Submission partially persisted; no success was reported");
    expect(alert).toHaveTextContent("evidence_link row 1: link rejected");
    expect(screen.queryByText("Observation batch persisted with evidence.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Row 1 sample or entity ID")).toHaveValue("sample-1");
  });
});

async function fillFirstRow(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Row 1 sample or entity ID"), "sample-1");
  await user.type(screen.getByLabelText("Row 1 measurement type"), "ct_value");
  await user.type(screen.getByLabelText("Row 1 value"), "19.4");
  await user.type(screen.getByLabelText("Row 1 unit"), "Ct");
}

function report(complete: boolean) {
  return {
    activity: { id: "activity-1", label: "Capture", kind: "observation_capture", status: "completed", startedAt: "", endedAt: "", metadata: {}, raw: {} },
    entities: [{ id: "observation-1", label: "sample-1 · ct_value", category: "observation", kind: "ct_value", state: "observed", properties: {}, createdAt: "", raw: {} }],
    activityIo: [{ entity_id: "observation-1", role: "output" }],
    associations: [{ id: "association-1" }],
    evidence: [{ id: "evidence-1" }],
    associationEvidence: complete ? [{ evidence_id: "evidence-1" }] : [],
    failures: [],
    complete,
  };
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
