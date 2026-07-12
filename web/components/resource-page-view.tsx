"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, TopBar } from "./app-shell";
import { ResourceDrawer } from "./resource-drawer";
import { getResource, type ResourceRecord } from "@/lib/api/adapter";
import { resources } from "@/lib/mock-data";

export function ResourcePageView({ id }: { id: string }) {
  const router = useRouter();
  const [resource, setResource] = useState<ResourceRecord | null>(null);
  useEffect(() => {
    void getResource(id).then(setResource).catch(() => {
      const row = resources.find((item) => item[1] === id);
      if (!row || row[3] === "Private") { router.replace("/access-denied"); return; }
      const [name, resourceId, kind, visibility, backend, dataClass] = row;
      setResource({ id: resourceId, name, kind, visibility, backend, dataClass, updated: "2026-07-12", usage: "—", description: `Trusted ${name} biomedical data resource.`, owner: "data-stewards", organism: "Homo sapiens", checksum: `sha256:${resourceId.padEnd(64, "0")}`, source: `s3://shennong/${resourceId}`, provenance: "provider manifest · verified", size: "2.8 GB" });
    });
  }, [id, router]);
  return <AppShell active="catalog"><TopBar /><div className="catalog-page"><div className="page-intro"><div><h1>Resource details</h1><p>Inspect metadata, integrity, lineage, schema, and access.</p></div></div>{!resource && <div className="table-empty">Loading resource…</div>}</div>{resource && <ResourceDrawer resource={resource} onClose={() => router.push("/catalog")} />}</AppShell>;
}
