"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FileBox, Globe2, Info, LockKeyhole, MoreHorizontal, Search, SlidersHorizontal } from "lucide-react";
import { AppShell, TinyBadge, TopBar } from "./app-shell";
import { listResources, ShennongApiError, type ResourceRecord } from "@/lib/api/adapter";
import { ResourceDrawer } from "./resource-drawer";

const tabs = [["All", "all"], ["Resources", "Resource"], ["Artifacts", "Artifact"], ["Relations", "Relation"]] as const;

export function CatalogView() {
  const [resources, setResources] = useState<ResourceRecord[]>([]);
  const [selected, setSelected] = useState<ResourceRecord | null>(null);
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const visibleResources = useMemo(() => resources.filter((resource) => (tab === "all" || resource.kind === tab) && `${resource.name} ${resource.id} ${resource.backend}`.toLowerCase().includes(query.toLowerCase())), [query, resources, tab]);

  useEffect(() => { void listResources().then(({ data }) => setResources(data)).catch((reason: unknown) => setError(reason instanceof ShennongApiError ? reason.message : "Failed to load catalog")).finally(() => setLoading(false)); }, []);
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("resource"); if (id) setSelected(resources.find((resource) => resource.id === id) ?? null); }, [resources]);
  const openResource = (resource: ResourceRecord) => { setSelected(resource); window.history.replaceState(null, "", `/catalog?resource=${resource.id}`); };
  const closeResource = () => { setSelected(null); window.history.replaceState(null, "", "/catalog"); };

  return <AppShell active="catalog"><TopBar /><div className="catalog-page">
    <div className="page-intro"><div><h1>Catalog</h1><p>Discover and explore trusted biomedical data resources.</p></div><button className="outline-button"><SlidersHorizontal />Saved searches <ChevronDown /></button></div>
    <div className="catalog-tabs">{tabs.map(([label, value]) => <button className={tab === value ? "active" : ""} key={value} onClick={() => setTab(value)}>{label}<span>{value === "all" ? resources.length : resources.filter((resource) => resource.kind === value).length}</span></button>)}</div>
    <div className="catalog-toolbar"><button className={`outline-button ${filterOpen ? "selected" : ""}`} onClick={() => setFilterOpen((value) => !value)}><SlidersHorizontal />Filter</button><label className="filter-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by name, owner, or backend..." /></label><div className="toolbar-spacer" /><select defaultValue="Updated" aria-label="Sort resources"><option>Updated</option><option>Name</option></select><button className="outline-button density-button" aria-label="Table actions"><MoreHorizontal /></button></div>
    {filterOpen && <div className="filter-row"><TinyBadge tone="blue">All API-visible records</TinyBadge><button className="text-button" onClick={() => setFilterOpen(false)}>Close</button></div>}
    <div className="catalog-table-wrap">{error ? <Empty title="Catalog unavailable" detail={error} /> : loading ? <Empty title="Loading live catalog…" /> : <><table className="catalog-table"><thead><tr><th className="check-col"><input type="checkbox" aria-label="Select all resources" /></th><th>Name</th><th>Type</th><th>Visibility</th><th>Backend</th><th>Updated</th><th>Usage <Info size={13} /></th><th aria-label="Actions" /></tr></thead><tbody>{visibleResources.map((resource) => <ResourceRow resource={resource} selected={selected?.id === resource.id} key={resource.id} onOpen={openResource} />)}</tbody></table>{visibleResources.length === 0 && <Empty title="No records returned" detail="The API returned no matching resources." />}</>}</div>
    <div className="table-footer"><span>{visibleResources.length ? `1–${visibleResources.length}` : "0"} of {resources.length}</span></div>
  </div>{selected && <ResourceDrawer resource={selected} onClose={closeResource} />}</AppShell>;
}

function Empty({ title, detail }: { title: string; detail?: string }) { return <div className="table-empty"><FileBox /><strong>{title}</strong>{detail && <span>{detail}</span>}</div>; }

function ResourceRow({ resource, selected, onOpen }: { resource: ResourceRecord; selected: boolean; onOpen: (resource: ResourceRecord) => void }) {
  return <tr className={selected ? "selected" : ""} onClick={() => onOpen(resource)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpen(resource)}><td className="check-col"><input type="checkbox" aria-label={`Select ${resource.name}`} onClick={(event) => event.stopPropagation()} /></td><td><div className="name-cell"><span className={`row-type-icon ${resource.kind.toLowerCase()}`}>{resource.kind === "Resource" ? <Globe2 /> : <FileBox />}</span><span><strong>{resource.name}</strong><small className="mono">{resource.id}</small></span></div></td><td>{resource.kind}</td><td><TinyBadge tone={resource.visibility === "Public" ? "blue" : "amber"}>{resource.visibility === "Public" ? <Globe2 /> : <LockKeyhole />}{resource.visibility}</TinyBadge></td><td>{resource.backend}</td><td>{resource.updated}</td><td>{resource.usage}</td><td><button className="row-action" aria-label={`Actions for ${resource.name}`} onClick={(event) => event.stopPropagation()}><MoreHorizontal /></button></td></tr>;
}
