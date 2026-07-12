import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UploadView } from "./upload-view";

vi.mock("next/navigation", () => ({ usePathname: () => "/console/uploads/new", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api/adapter", () => ({ getSession: async () => ({ authenticated:false, user_id:"", role:"", scopes:[] }), getHealth:async()=>({status:"ok"}), signOut: async () => undefined, uploadFile:async()=>({id:"upload-1"}),registerUploads:async()=>({id:"resource-1"}) }));

describe("UploadView", () => {
  it("moves through the dataset registration steps", async () => {
    render(<UploadView />);
    expect(screen.getByRole("heading", { name:"Select files" })).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input,{target:{files:[new File(["real"],"matrix.tsv",{type:"text/tab-separated-values"})]}});
    fireEvent.click(screen.getByRole("button", { name:"Continue" }));
    expect(screen.getByRole("heading", { name:"Describe resource" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Resource ID"),{target:{value:"resource-1"}});
    fireEvent.change(screen.getByLabelText("Resource name"),{target:{value:"Resource 1"}});
    fireEvent.click(screen.getByRole("button", { name:"Continue" }));
    await waitFor(()=>expect(screen.getByRole("heading", { name:"Access & format" })).toBeInTheDocument());
  });
});
