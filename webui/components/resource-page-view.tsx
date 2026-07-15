"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, TopBar } from "./app-shell";
import { ResourceDrawer } from "./resource-drawer";
import { getResource, type ResourceRecord } from "@/lib/api/adapter";

export function ResourcePageView({ id }: { id: string }) {
  const router = useRouter();
  const [resource, setResource] = useState<ResourceRecord | null>(null);
  useEffect(() => {
    void getResource(id).then(setResource).catch(() => router.replace("/access-denied"));
  }, [id, router]);
  return <AppShell active="resources"><TopBar /><div className="catalog-page"><div className="page-intro"><div><h1>Resource details</h1><p>Inspect metadata, integrity, lineage, schema, and access.</p></div></div>{!resource && <div className="table-empty">Loading Resource…</div>}</div>{resource && <ResourceDrawer resource={resource} onClose={() => router.push("/resources")} />}</AppShell>;
}
