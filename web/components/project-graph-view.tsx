"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { FormEvent, useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CornerDownRight, GitBranch, Network, Search, ShieldAlert, X } from "lucide-react";
import {
  getBioGraphSubgraph,
  getProjectContextPack,
  listProjectAssociationEvidence,
  type BioGraphEdge,
  type BioGraphState,
  type JsonRecord,
} from "@/lib/api/adapter";
import { AppShell, SectionHeader, TinyBadge, TopBar } from "./app-shell";
import { ProjectApiError } from "./projects-view";

const ProjectGraphCanvas = dynamic(
  () => import("./project-graph-canvas").then((module) => module.ProjectGraphCanvas),
  { ssr: false, loading: () => <div className="graph-canvas-loading">Loading the interactive graph renderer…</div> },
);

export function ProjectGraphView({ projectId }: { projectId: string }) {
  const [root, setRoot] = useState("");
  const [rootDraft, setRootDraft] = useState("");
  const [depth, setDepth] = useState(1);
  const [selectedEdge, setSelectedEdge] = useState<BioGraphEdge | null>(null);
  const context = useQuery({ queryKey: ["projects", projectId, "context-pack"], queryFn: () => getProjectContextPack(projectId) });
  const initialRoot = context.data?.entities[0]?.id ?? "";
  const queryRoot = root || initialRoot;
  const graph = useQuery({
    queryKey: ["biograph", "subgraph", queryRoot, depth, 80],
    queryFn: () => getBioGraphSubgraph(queryRoot, depth, 80),
    enabled: queryRoot.length > 0,
  });

  function focus(event: FormEvent) {
    event.preventDefault();
    const nextRoot = rootDraft.trim() || initialRoot;
    if (nextRoot) {
      setSelectedEdge(null);
      setRoot(nextRoot);
    }
  }
  const focusNode = useCallback((nodeId: string) => {
    setRootDraft(nodeId);
    setRoot(nodeId);
    setSelectedEdge(null);
  }, []);

  return (
    <AppShell active="projects">
      <TopBar
        title="Project BioGraph"
        description="Evidence-aware, bounded graph exploration for this research workspace."
        search={false}
        action={<Link className="outline-button" href={`/projects/${encodeURIComponent(projectId)}`}><ArrowLeft />Back to workspace</Link>}
      />
      <div className="workspace-page project-graph-page">
        <nav className="project-tabs" aria-label="Project sections">
          <Link href={`/projects/${encodeURIComponent(projectId)}`}>Workspace</Link>
          <Link className="active" href={`/projects/${encodeURIComponent(projectId)}/graph`}>BioGraph</Link>
        </nav>
        <SectionHeader title="Focused subgraph" description="Choose one root and 1–3 hops. ShennongDB never sends the entire project graph to the browser." />
        <form className="graph-controls" onSubmit={focus}>
          <label><Search /><input aria-label="Graph root entity ID" value={rootDraft} onChange={(event) => setRootDraft(event.target.value)} placeholder={initialRoot || "No root entity available"} /></label>
          <label>Depth<select aria-label="Graph depth" value={depth} onChange={(event) => setDepth(Number(event.target.value))}><option value={1}>1 hop</option><option value={2}>2 hops</option><option value={3}>3 hops</option></select></label>
          <button className="primary-button" disabled={!queryRoot && !rootDraft.trim()}><GitBranch />Explore</button>
        </form>
        <div className="graph-legend" aria-label="Graph evidence states">
          {(["observed", "computed", "hypothesis", "validated", "refuted"] as BioGraphState[]).map((state) => <span key={state} className={`graph-state graph-state-${state}`}><i />{state}</span>)}
          <span className="graph-evidence-key"><i className="supporting" />supporting evidence</span>
          <span className="graph-evidence-key"><i className="contradicting" />contradicting evidence</span>
        </div>
        {context.error ? <ProjectApiError error={context.error} /> : null}
        {context.isPending ? <div className="loading-state">Loading graph entry points…</div> : null}
        {!context.isPending && context.data && context.data.entities.length === 0 ? <div className="project-inline-empty"><ShieldAlert />This project has no graph entities to use as a root.</div> : null}
        {graph.error ? <ProjectApiError error={graph.error} /> : null}
        {graph.isFetching ? <div className="graph-progress" role="status">Loading a bounded {depth}-hop subgraph…</div> : null}
        {graph.data ? (
          <section className="project-panel graph-panel">
            <div className="graph-panel-meta"><span><Network />Root <code>{graph.data.root}</code></span><span>{graph.data.nodes.length} nodes · {graph.data.edges.length} paths</span>{graph.data.truncated ? <TinyBadge tone="amber">server-truncated</TinyBadge> : <TinyBadge tone="green">bounded result</TinyBadge>}</div>
            <ProjectGraphCanvas graph={graph.data} onSelectEdge={setSelectedEdge} onFocusNode={focusNode} />
            <AccessiblePathList edges={graph.data.edges} onSelect={setSelectedEdge} />
          </section>
        ) : null}
      </div>
      {selectedEdge ? <EvidenceDrawer projectId={projectId} edge={selectedEdge} onClose={() => setSelectedEdge(null)} /> : null}
    </AppShell>
  );
}

function AccessiblePathList({ edges, onSelect }: { edges: BioGraphEdge[]; onSelect: (edge: BioGraphEdge) => void }) {
  return (
    <div className="graph-path-list">
      <h3>Returned paths</h3>
      {edges.map((edge) => (
        <button key={edge.id} onClick={() => onSelect(edge)}>
          <code>{edge.subjectId}</code><CornerDownRight /><span>{edge.predicate}</span><CornerDownRight /><code>{edge.objectId}</code><StatePill state={edge.state} />
        </button>
      ))}
      {edges.length === 0 ? <p>No associations were returned for this root and depth.</p> : null}
    </div>
  );
}

function EvidenceDrawer({ projectId, edge, onClose }: { projectId: string; edge: BioGraphEdge; onClose: () => void }) {
  const evidence = useQuery({
    queryKey: ["projects", projectId, "associations", edge.id, "evidence"],
    queryFn: () => listProjectAssociationEvidence(projectId, edge.id),
  });
  return (
    <><button className="drawer-scrim" onClick={onClose} aria-label="Close evidence details" /><aside className="resource-drawer evidence-drawer" role="dialog" aria-modal="true" aria-label="Association evidence">
      <div className="drawer-header"><div><h2>{edge.predicate}</h2><p>Association and linked evidence</p></div><button className="icon-button" onClick={onClose} aria-label="Close evidence details"><X /></button></div>
      <div className="drawer-content">
        <section className="detail-section"><h3>Statement</h3><dl className="detail-list"><div><dt>Subject</dt><dd className="mono">{edge.subjectId}</dd></div><div><dt>Predicate</dt><dd>{edge.predicate}</dd></div><div><dt>Object</dt><dd className="mono">{edge.objectId}</dd></div><div><dt>Knowledge state</dt><dd><StatePill state={edge.state} /></dd></div><div><dt>Polarity</dt><dd>{edge.polarity}</dd></div></dl></section>
        <section className="detail-section"><h3>Qualifiers</h3><JsonDetails value={edge.qualifiers} empty="No association qualifiers were persisted." /></section>
        <section className="detail-section"><h3>Evidence</h3>{evidence.error ? <ProjectApiError error={evidence.error} compact /> : null}{evidence.isPending ? <div className="loading-state">Loading linked evidence…</div> : null}{evidence.data ? <EvidenceList rows={evidence.data} /> : null}</section>
      </div>
    </aside></>
  );
}

function EvidenceList({ rows }: { rows: JsonRecord[] }) {
  if (rows.length === 0) return <p>No evidence is linked to this association.</p>;
  return <div className="evidence-list">{rows.map((row, index) => {
    const evidence = object(row.evidence ?? row);
    const link = object(row.association_evidence ?? row.link ?? row);
    const stance = text(link.stance, "neutral");
    return <article key={text(evidence.id, `evidence-${index}`)}><div><strong>{text(evidence.evidence_type, "Evidence")}</strong><TinyBadge tone={stance === "contradicting" ? "amber" : stance === "supporting" ? "green" : "blue"}>{stance}</TinyBadge></div><code>{text(evidence.id)}</code><JsonDetails value={object(evidence.statistics)} empty="No statistics supplied." /><JsonDetails value={object(evidence.locator)} empty="No locator supplied." /></article>;
  })}</div>;
}

function JsonDetails({ value, empty }: { value: JsonRecord; empty: string }) {
  const entries = Object.entries(value);
  if (entries.length === 0) return <p>{empty}</p>;
  return <dl className="compact-json">{entries.map(([key, item]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{typeof item === "object" ? JSON.stringify(item) : String(item)}</dd></div>)}</dl>;
}

function StatePill({ state }: { state: BioGraphState }) {
  return <span className={`graph-state graph-state-${state}`}><i />{state}</span>;
}

function object(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, fallback = "—") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
