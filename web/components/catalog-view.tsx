"use client";

import { useEffect, useMemo, useState } from "react";
import { mockApi, resources, type ResourceRecord } from "@/lib/api/adapter";

type Role = "Guest" | "User" | "Admin";

function ResourceDrawer({ resource, onClose }: { resource: ResourceRecord | null; onClose: () => void }) {
  if (!resource) return null;
  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(7,29,32,.28)", zIndex: 20 }} onClick={onClose}>
      <aside className="panel" onClick={(event) => event.stopPropagation()} style={{ position: "absolute", right: 0, top: 0, height: "100%", width: "min(520px, 100%)", borderRadius: 0, padding: 28, overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}><div><div className="eyebrow">{resource.kind} detail</div><h2 style={{ margin: "8px 0 4px", fontSize: 24 }}>{resource.name}</h2><div className="muted" style={{ fontSize: 13 }}>{resource.id}</div></div><button className="button" onClick={onClose} aria-label="Close resource drawer">Close</button></div>
        <p className="muted" style={{ lineHeight: 1.6 }}>{resource.description}</p>
        <dl style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "12px 14px", fontSize: 13 }}>
          <dt className="muted">Visibility</dt><dd>{resource.visibility}</dd><dt className="muted">Data class</dt><dd>{resource.dataClass}</dd><dt className="muted">Backend</dt><dd>{resource.backend}</dd><dt className="muted">Owner</dt><dd>{resource.owner}</dd><dt className="muted">Organism</dt><dd>{resource.organism}</dd><dt className="muted">Size</dt><dd>{resource.size}</dd><dt className="muted">Checksum</dt><dd style={{ overflowWrap: "anywhere" }}>{resource.checksum}</dd><dt className="muted">Source</dt><dd style={{ overflowWrap: "anywhere" }}>{resource.source}</dd><dt className="muted">Provenance</dt><dd>{resource.provenance}</dd>
        </dl>
        <div style={{ display: "flex", gap: 10, marginTop: 24 }}><button className="button primary">Open resource</button><button className="button">Copy ID</button></div>
      </aside>
    </div>
  );
}

export function CatalogView() {
  const [items, setItems] = useState<ResourceRecord[]>(resources);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("All");
  const [role, setRole] = useState<Role>("Guest");
  const [selected, setSelected] = useState<ResourceRecord | null>(null);
  const [page, setPage] = useState(1);
  const [commandOpen, setCommandOpen] = useState(false);
  useEffect(() => { void mockApi.listResources().then(setItems); }, []);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(true); } }; window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); }, []);
  const filtered = useMemo(() => items.filter((item) => (kind === "All" || item.kind === kind) && `${item.name} ${item.description} ${item.organism} ${item.backend}`.toLowerCase().includes(query.toLowerCase())), [items, kind, query]);
  const pageItems = filtered.slice((page - 1) * 6, page * 6);
  const setFilter = (next: string) => { setKind(next); setPage(1); };
  return <main className="shell">
    <header style={{ borderBottom: "1px solid var(--line)", background: "rgba(255,255,255,.9)", position: "sticky", top: 0, zIndex: 5 }}><div style={{ maxWidth: 1440, margin: "auto", padding: "16px 24px", display: "flex", alignItems: "center", gap: 22 }}><a href="/catalog" style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800 }}><span style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 10, background: "var(--teal)", color: "white" }}>S</span> ShennongDB</a><nav className="desktop-only" style={{ display: "flex", gap: 18, fontSize: 14 }}><a href="/catalog" style={{ color: "var(--teal)", fontWeight: 700 }}>Catalog</a><a href="/console/api-access">Console</a><a href="/admin/dashboard">Admin</a></nav><div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}><button className="button desktop-only" onClick={() => setCommandOpen(true)}>⌘ K</button><select className="input" style={{ width: 100, padding: "8px 9px" }} value={role} onChange={(event) => setRole(event.target.value as Role)} aria-label="Current role"><option>Guest</option><option>User</option><option>Admin</option></select><span className="pill teal">{role}</span></div></div></header>
    <section style={{ maxWidth: 1440, margin: "auto", padding: "48px 24px" }}><div style={{ maxWidth: 760 }}><div className="eyebrow">Public data catalog</div><h1 style={{ fontSize: "clamp(34px, 5vw, 60px)", lineHeight: 1.03, margin: "12px 0 16px", letterSpacing: "-.04em" }}>Trusted biomedical resources, ready to query.</h1><p className="muted" style={{ fontSize: 17, lineHeight: 1.6 }}>Discover governed Resources, immutable Artifacts, and evidence-backed Relations across the ShennongDB data plane.</p></div>
      <div className="panel" style={{ marginTop: 32, padding: 18 }}><div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><input className="input" style={{ flex: "1 1 280px" }} placeholder="Search resources, organisms, backends…" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="button" onClick={() => setCommandOpen(true)}>Command palette</button></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}><span className="muted" style={{ padding: "5px 4px", fontSize: 13 }}>Type</span>{["All", "Resource", "Artifact", "Relation"].map((value) => <button key={value} className={`pill ${kind === value ? "teal" : ""}`} onClick={() => setFilter(value)}>{value}</button>)}</div></div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", margin: "34px 0 12px" }}><div><div className="eyebrow">{filtered.length} matches</div><h2 style={{ margin: "7px 0 0", fontSize: 24 }}>Catalog</h2></div><div className="muted" style={{ fontSize: 13 }}>Updated continuously · page {page}</div></div>
      <div className="panel" style={{ overflowX: "auto" }}><table className="data-table"><thead><tr><th>Name</th><th>Type</th><th>Visibility</th><th>Backend</th><th>Data class</th><th>Updated</th></tr></thead><tbody>{pageItems.map((item) => <tr key={item.id} onClick={() => setSelected(item)} style={{ cursor: "pointer" }}><td><div style={{ fontWeight: 700 }}>{item.name}</div><div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{item.organism} · {item.size}</div></td><td><span className="pill">{item.kind}</span></td><td><span className={`pill ${item.visibility === "Public" ? "teal" : ""}`}>{item.visibility}</span></td><td>{item.backend}</td><td>{item.dataClass}</td><td className="muted">{item.updated}</td></tr>)}</tbody></table>{!pageItems.length && <div style={{ padding: 36, textAlign: "center" }} className="muted">No resources match this filter.</div>}</div>
      <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 20 }}><button className="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span className="pill" style={{ paddingTop: 10 }}>Page {page}</span><button className="button" disabled={page * 6 >= filtered.length} onClick={() => setPage((value) => value + 1)}>Next</button></div>
    </section><ResourceDrawer resource={selected} onClose={() => setSelected(null)} />{commandOpen && <div role="dialog" aria-modal="true" onClick={() => setCommandOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 30, background: "rgba(7,29,32,.34)", padding: "12vh 20px" }}><div className="panel" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 560, margin: "auto", padding: 20 }}><div className="eyebrow">Command palette</div><input autoFocus className="input" style={{ margin: "12px 0" }} placeholder="Type a command…" /><button className="button" style={{ width: "100%", textAlign: "left" }} onClick={() => { setCommandOpen(false); setFilter("Public"); }}>Filter public resources</button><button className="button" style={{ width: "100%", textAlign: "left", marginTop: 8 }} onClick={() => setCommandOpen(false)}>Close</button></div></div>}</main>;
}
