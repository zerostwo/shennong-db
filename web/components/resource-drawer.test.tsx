import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResourceDrawer } from "./resource-drawer";
import type { ResourceRecord } from "@/lib/api/adapter";

vi.mock("@/lib/api/adapter", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/adapter")>()), listArtifacts:async()=>[], listRelations:async()=>[], getSession:async()=>({authenticated:true,user_id:"user-1",role:"user",scopes:["resource.read"]}) }));

const resource: ResourceRecord = { id:"toil", name:"Toil RNA-seq (Homo sapiens)", kind:"Resource", visibility:"Public", backend:"TileDB", updated:"2026-07-12", usage:"0", dataClass:"canonical", description:"Trusted expression data", owner:"data-stewards", organism:"Homo sapiens", checksum:"sha256:test", source:"s3://shennong/toil", provenance:"verified", size:"2.8 GB", raw:{metadata:{description:"Trusted expression data"},spec:{backend:"TileDB"},permissions:{visibility:"public"},provenance:{verified:true}} };

describe("ResourceDrawer", () => {
  it("shows resource metadata, switches tabs, and closes with Escape", () => {
    const close = vi.fn(); render(<ResourceDrawer resource={resource} onClose={close} />);
    expect(screen.getAllByText("Trusted expression data").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Schema" }));
    expect(screen.getByText("Resource schema / spec")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });
});
