import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResourceDrawer } from "./resource-drawer";
import type { ResourceRecord } from "@/lib/api/adapter";

const resource: ResourceRecord = { id:"toil", name:"Toil RNA-seq (Homo sapiens)", kind:"Resource", visibility:"Public", backend:"TileDB", updated:"Today", usage:"1.12M", dataClass:"canonical", description:"Trusted expression data", owner:"data-stewards", organism:"Homo sapiens", checksum:"sha256:test", source:"s3://shennong/toil", provenance:"verified", size:"2.8 GB" };

describe("ResourceDrawer", () => {
  it("shows resource metadata, switches tabs, and closes with Escape", () => {
    const close = vi.fn(); render(<ResourceDrawer resource={resource} onClose={close} />);
    expect(screen.getByText("Trusted expression data")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Schema" }));
    expect(screen.getByText("Schema (logical)")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });
});
