import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UploadView } from "./upload-view";

vi.mock("next/navigation", () => ({ usePathname: () => "/console/uploads/new", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api/adapter", () => ({ getSession: async () => ({ authenticated:false, user_id:"", role:"", scopes:[] }), signOut: async () => undefined }));

describe("UploadView", () => {
  it("moves through the dataset registration steps", async () => {
    render(<UploadView />);
    expect(screen.getByRole("heading", { name:"Select files" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name:/Continue|Use demo files/ }));
    expect(screen.getByRole("heading", { name:"Describe dataset" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name:"Continue" }));
    await waitFor(()=>expect(screen.getByRole("heading", { name:"Map artifacts" })).toBeInTheDocument());
  });
});
