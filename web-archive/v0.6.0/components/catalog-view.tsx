"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileBox,
  FolderPlus,
  Globe2,
  Info,
  LockKeyhole,
  MoreHorizontal,
  Rows3,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { createColumnHelper, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { parseAsString, useQueryState } from "nuqs";
import type { ResourceRecord } from "@/lib/api/adapter";
import { useResources } from "@/features/catalog/use-resources";
import { AppShell, TinyBadge, TopBar } from "./app-shell";
import { ResourceDrawer } from "./resource-drawer";

const tabs = [
  ["All", "all"],
  ["Resources", "Resource"],
  ["Artifacts", "Artifact"],
  ["Relations", "Relation"],
] as const;
const columnHelper = createColumnHelper<ResourceRecord>();
const rowModelColumns = [columnHelper.accessor("id", { header: "ID" })];
const pageSize = 25;

export function CatalogView() {
  const { data: resources = [], isLoading: loading } = useResources();
  const [selected, setSelected] = useState<ResourceRecord | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useQueryState("type", parseAsString.withDefault("all"));
  const [query, setQuery] = useQueryState("q", parseAsString.withDefault(""));
  const [visibility, setVisibility] = useQueryState("visibility", parseAsString.withDefault("all"));
  const [backend, setBackend] = useQueryState("backend", parseAsString.withDefault("all"));
  const [dataClass, setDataClass] = useQueryState("dataClass", parseAsString.withDefault("all"));
  const [organism, setOrganism] = useQueryState("organism", parseAsString.withDefault("all"));
  const [owner, setOwner] = useQueryState("owner", parseAsString.withDefault("all"));
  const [tag, setTag] = useQueryState("tag", parseAsString.withDefault(""));
  const [status, setStatus] = useQueryState("status", parseAsString.withDefault("all"));
  const [updated, setUpdated] = useQueryState("updated", parseAsString.withDefault("all"));
  const [sort, setSort] = useQueryState("sort", parseAsString.withDefault("updated"));
  const [filterOpen, setFilterOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState("");

  const filteredResources = useMemo(
    () =>
      resources
        .filter(
          (resource) =>
            (tab === "all" || resource.kind === tab) &&
            (visibility === "all" || resource.visibility.toLowerCase() === visibility) &&
            (backend === "all" || resource.backend.toLowerCase() === backend) &&
            (dataClass === "all" || resource.dataClass === dataClass) &&
            (organism === "all" || resource.organism === organism) &&
            (owner === "all" || resource.owner === owner) &&
            (status === "all" || status === "available") &&
            (updated === "all" || updated === "30d") &&
            `${resource.name} ${resource.id} ${resource.backend} ${resource.owner} ${resource.organism}`
              .toLowerCase()
              .includes(query.toLowerCase()) &&
            (!tag || `${resource.name} ${resource.dataClass}`.toLowerCase().includes(tag.toLowerCase())),
        )
        .toSorted((a, b) =>
          sort === "name" ? a.name.localeCompare(b.name) : b.updated.localeCompare(a.updated),
        ),
    [backend, dataClass, organism, owner, query, resources, sort, status, tab, tag, updated, visibility],
  );
  const table = useReactTable({
    data: filteredResources,
    columns: rowModelColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });
  const allRows = table.getRowModel().rows.map((row) => row.original);
  const pageCount = Math.max(1, Math.ceil(allRows.length / pageSize));
  const visibleResources = allRows.slice(page * pageSize, (page + 1) * pageSize);

  useEffect(() => setPage(0), [backend, dataClass, organism, owner, query, sort, status, tab, tag, updated, visibility]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("resource");
    if (id) setSelected(resources.find((resource) => resource.id === id) ?? null);
  }, [resources]);
  useEffect(() => {
    const onPop = () => {
      const id = new URLSearchParams(location.search).get("resource");
      setSelected(resources.find((resource) => resource.id === id) ?? null);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [resources]);

  const updateResourceUrl = (id?: string) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("resource", id);
    else url.searchParams.delete("resource");
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
  };
  const openResource = (resource: ResourceRecord) => {
    setSelected(resource);
    updateResourceUrl(resource.id);
  };
  const closeResource = () => {
    setSelected(null);
    updateResourceUrl();
  };
  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 1800);
  };
  const clearFilters = () => {
    void Promise.all([
      setVisibility(null),
      setBackend(null),
      setDataClass(null),
      setOrganism(null),
      setOwner(null),
      setTag(null),
      setStatus(null),
      setUpdated(null),
    ]);
  };
  const pageStart = allRows.length ? page * pageSize + 1 : 0;
  const pageEnd = Math.min((page + 1) * pageSize, allRows.length);

  return (
    <AppShell active="catalog">
      <TopBar />
      <div className="catalog-page">
        <div className="page-intro">
          <div><h1>Catalog</h1><p>Discover and explore trusted biomedical data resources.</p></div>
          <button className="outline-button" onClick={() => { void setVisibility("public"); void setBackend("tiledb"); showNotice("Saved search applied"); }}><SlidersHorizontal />Saved searches <ChevronDown /></button>
        </div>
        <div className="catalog-tabs">
          {tabs.map(([label, value]) => (
            <button className={tab === value ? "active" : ""} key={value} onClick={() => void setTab(value === "all" ? null : value)}>
              {label}<span>{value === "all" ? resources.length : resources.filter((resource) => resource.kind === value).length}</span>
            </button>
          ))}
        </div>
        <div className="catalog-toolbar">
          <button className={`outline-button ${filterOpen ? "selected" : ""}`} onClick={() => setFilterOpen((value) => !value)}><SlidersHorizontal />Filter</button>
          <label className="filter-search"><Search /><input value={query} onChange={(event) => void setQuery(event.target.value || null)} placeholder="Filter by name, owner, or backend..." /></label>
          <div className="toolbar-spacer" />
          <select value={sort} onChange={(event) => void setSort(event.target.value === "updated" ? null : event.target.value)} aria-label="Sort resources"><option value="updated">Updated</option><option value="name">Name</option></select>
          <button className="outline-button density-button" aria-label="Toggle compact density" aria-pressed={compact} onClick={() => setCompact((value) => !value)}><Rows3 /></button>
        </div>
        {filterOpen && (
          <div className="filter-row catalog-advanced-filters">
            <FilterSelect label="Visibility" value={visibility} onChange={(value) => void setVisibility(value === "all" ? null : value)} options={["all", "public", "private"]} />
            <FilterSelect label="Backend" value={backend} onChange={(value) => void setBackend(value === "all" ? null : value)} options={["all", "tiledb", "postgresql", "clickhouse", "s3", "local"]} />
            <FilterSelect label="Data class" value={dataClass} onChange={(value) => void setDataClass(value === "all" ? null : value)} options={["all", "raw", "canonical", "derived", "cache", "staging"]} />
            <FilterSelect label="Organism" value={organism} onChange={(value) => void setOrganism(value === "all" ? null : value)} options={["all", "Homo sapiens"]} />
            <FilterSelect label="Owner" value={owner} onChange={(value) => void setOwner(value === "all" ? null : value)} options={["all", "data-stewards"]} />
            <label>Tag<input value={tag} onChange={(event) => void setTag(event.target.value || null)} placeholder="rna-seq" /></label>
            <FilterSelect label="Status" value={status} onChange={(value) => void setStatus(value === "all" ? null : value)} options={["all", "available"]} />
            <FilterSelect label="Updated" value={updated} onChange={(value) => void setUpdated(value === "all" ? null : value)} options={["all", "30d"]} labels={{ "30d": "Last 30 days" }} />
            <button className="text-button" onClick={clearFilters}>Clear filters</button>
            <button className="text-button" onClick={() => setFilterOpen(false)}>Close</button>
          </div>
        )}
        <div className={`catalog-table-wrap ${compact ? "compact" : ""}`}>
          {loading ? <Empty title="Loading live catalog…" /> : (
            <>
              <table className="catalog-table">
                <thead><tr><th className="check-col"><input type="checkbox" aria-label="Select all resources" checked={visibleResources.length > 0 && visibleResources.every((resource) => selectedIds.has(resource.id))} onChange={(event) => setSelectedIds(event.target.checked ? new Set(visibleResources.map((resource) => resource.id)) : new Set())} /></th><th>Name</th><th>Type</th><th>Visibility</th><th>Backend</th><th>Updated</th><th>Usage <Info size={13} /></th><th aria-label="Actions" /></tr></thead>
                <tbody>{visibleResources.map((resource) => <ResourceRow resource={resource} selected={selected?.id === resource.id} checked={selectedIds.has(resource.id)} key={resource.id} onCheck={(checked) => setSelectedIds((value) => { const next = new Set(value); if (checked) next.add(resource.id); else next.delete(resource.id); return next; })} onOpen={openResource} onNotice={showNotice} />)}</tbody>
              </table>
              {visibleResources.length === 0 && <Empty title="No Results" detail="No catalog objects match the current filters." />}
            </>
          )}
        </div>
        <div className="table-footer">
          <span>{pageStart}–{pageEnd} of {allRows.length}</span>
          <div className="pagination-actions"><button className="icon-button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft /></button><span>Page {page + 1} of {pageCount}</span><button className="icon-button" aria-label="Next page" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}><ChevronRight /></button></div>
        </div>
      </div>
      {selected && <ResourceDrawer resource={selected} onClose={closeResource} />}
      {notice && <div className="toast" role="status"><CheckCircle2 />{notice}</div>}
    </AppShell>
  );
}

function FilterSelect({ label, value, options, labels = {}, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option value={option} key={option}>{labels[option] ?? (option === "all" ? "All" : option)}</option>)}</select></label>;
}

function Empty({ title, detail }: { title: string; detail?: string }) {
  return <div className="table-empty"><FileBox /><strong>{title}</strong>{detail && <span>{detail}</span>}</div>;
}

function ResourceRow({ resource, selected, checked, onCheck, onOpen, onNotice }: { resource: ResourceRecord; selected: boolean; checked: boolean; onCheck: (checked: boolean) => void; onOpen: (resource: ResourceRecord) => void; onNotice: (message: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const choose = (action: () => void) => { action(); setMenuOpen(false); };
  return (
    <tr className={selected ? "selected" : ""} onClick={() => onOpen(resource)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpen(resource)}>
      <td className="check-col"><input type="checkbox" aria-label={`Select ${resource.name}`} checked={checked} onChange={(event) => onCheck(event.target.checked)} onClick={(event) => event.stopPropagation()} /></td>
      <td><div className="name-cell"><span className={`row-type-icon ${resource.kind.toLowerCase()}`}>{resource.kind === "Resource" ? <Globe2 /> : <FileBox />}</span><span><strong>{resource.name}</strong><small className="mono">{resource.id}</small></span></div></td>
      <td>{resource.kind}</td>
      <td><TinyBadge tone={resource.visibility === "Public" ? "blue" : "amber"}>{resource.visibility === "Public" ? <Globe2 /> : <LockKeyhole />}{resource.visibility}</TinyBadge></td>
      <td>{resource.backend}</td><td>{resource.updated}</td><td>{resource.usage}</td>
      <td className="row-action-cell">
        <button className="row-action" aria-label={`Actions for ${resource.name}`} aria-expanded={menuOpen} onClick={(event) => { event.stopPropagation(); setMenuOpen((value) => !value); }}><MoreHorizontal /></button>
        {menuOpen && <div className="row-action-menu" onClick={(event) => event.stopPropagation()}>
          <button onClick={() => choose(() => onOpen(resource))}><ExternalLink />View details</button>
          <a href={`/catalog/resources/${resource.id}`}><ExternalLink />Open resource</a>
          <button onClick={() => choose(() => { void navigator.clipboard?.writeText(resource.id); onNotice("Resource ID copied"); })}><Copy />Copy ID</button>
          <button onClick={() => choose(() => { onOpen(resource); window.setTimeout(() => document.querySelector<HTMLButtonElement>(".drawer-tabs button:nth-child(4)")?.click(), 0); })}><ExternalLink />View relations</button>
          <button onClick={() => choose(() => { onOpen(resource); onNotice("Artifacts loaded in resource details"); })}><FileBox />View artifacts</button>
          <a href={`/api/v1/catalog/resources/${resource.id}`} download><Download />Download metadata</a>
          <button onClick={() => choose(() => onNotice("Added to RNA expression atlas"))}><FolderPlus />Add to collection</button>
        </div>}
      </td>
    </tr>
  );
}
