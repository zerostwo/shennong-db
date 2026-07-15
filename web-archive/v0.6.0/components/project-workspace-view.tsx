"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Beaker,
  Boxes,
  Database,
  FileUp,
  FlaskConical,
  GitBranch,
  Network,
  ShieldAlert,
} from "lucide-react";
import {
  getProjectContextPack,
  listProjectActivities,
  listProjectEntities,
  listProjectResources,
  type JsonRecord,
  type ProjectContextPack,
} from "@/lib/api/adapter";
import { AppShell, SectionHeader, TinyBadge, TopBar } from "./app-shell";
import { ProjectApiError } from "./projects-view";
import { ProjectObservationTable } from "./project-observation-table";

const projectKey = (projectId: string) => ["projects", projectId] as const;

export function ProjectWorkspaceView({ projectId }: { projectId: string }) {
  const [loadFullLists, setLoadFullLists] = useState(false);
  const context = useQuery({ queryKey: [...projectKey(projectId), "context-pack"], queryFn: () => getProjectContextPack(projectId) });
  const fullEntities = useQuery({ queryKey: [...projectKey(projectId), "entities"], queryFn: () => listProjectEntities(projectId), enabled: context.data?.truncated === true && loadFullLists });
  const fullActivities = useQuery({ queryKey: [...projectKey(projectId), "activities"], queryFn: () => listProjectActivities(projectId), enabled: context.data?.truncated === true && loadFullLists });
  const fullResources = useQuery({ queryKey: [...projectKey(projectId), "resources"], queryFn: () => listProjectResources(projectId), enabled: context.data?.truncated === true && loadFullLists });
  const entities = fullEntities.data ?? context.data?.entities;
  const activities = fullActivities.data ?? context.data?.activities;
  const resources = fullResources.data ?? context.data?.resources;

  return (
    <AppShell active="projects">
      <TopBar
        title={context.data?.project.name ?? "Project workspace"}
        description={context.data?.project.description || `Project ${projectId}`}
        search={false}
        action={
          <div className="project-top-actions">
            <Link className="outline-button" href={`/projects/${encodeURIComponent(projectId)}/graph`}><Network />Open BioGraph</Link>
            <Link className="primary-button" href={`/projects/${encodeURIComponent(projectId)}/upload`}><FileUp />Upload experimental data</Link>
          </div>
        }
      />
      <div className="workspace-page project-workspace-page">
        <nav className="project-tabs" aria-label="Project sections">
          <Link className="active" href={`/projects/${encodeURIComponent(projectId)}`}>Workspace</Link>
          <Link href={`/projects/${encodeURIComponent(projectId)}/graph`}>BioGraph</Link>
        </nav>
        {context.error ? <ProjectApiError error={context.error} /> : null}
        {context.isPending ? <div className="loading-state">Loading the project context pack…</div> : null}
        {context.data?.truncated ? <div className="project-limit-notice" role="status"><ShieldAlert /><span><strong>Context pack reached its server limit.</strong> The workspace is showing the bounded pack until you request the complete lists.</span><button className="outline-button" disabled={loadFullLists} onClick={() => setLoadFullLists(true)}>{loadFullLists ? "Loading full lists…" : "Load complete lists"}</button></div> : null}
        <section className="project-overview-grid" aria-label="Project overview">
          <Metric icon={<FlaskConical />} label="Studies" value={context.data ? String(context.data.studies.length) : "—"} loading={context.isPending} />
          <Metric icon={<Database />} label="Entities" value={entities ? String(entities.length) : "—"} loading={context.isPending || fullEntities.isFetching} />
          <Metric icon={<Activity />} label="Activities" value={activities ? String(activities.length) : "—"} loading={context.isPending || fullActivities.isFetching} />
          <Metric icon={<Boxes />} label="Resources" value={resources ? String(resources.length) : "—"} loading={context.isPending || fullResources.isFetching} />
        </section>

        <section className="project-panel context-pack-panel">
          <SectionHeader title="Agent context pack" description="Bounded, permission-filtered context returned by ShennongDB—not an LLM-generated browser summary." />
          {context.data ? <ContextPackDetails context={context.data} /> : null}
        </section>

        <div className="project-section-grid">
          <section className="project-panel">
            <SectionHeader title="Studies" description="Study records supplied by the project context pack." />
            {context.data ? <StudyList rows={context.data.studies} /> : null}
          </section>
          <section className="project-panel">
            <SectionHeader title="Resources" description="Versioned data products linked to this project." />
            {fullResources.error ? <ProjectApiError error={fullResources.error} compact /> : null}
            {fullResources.isFetching ? <div className="loading-state">Loading complete resource list…</div> : null}
            {resources ? (
              <div className="project-object-list">
                {resources.map((resource) => (
                  <Link key={resource.id} href={`/catalog/resources/${encodeURIComponent(resource.id)}`}>
                    <span className="project-object-icon"><Boxes /></span>
                    <span><strong>{resource.name}</strong><small>{resource.id} · {resource.backend}</small></span>
                    <TinyBadge tone={resource.visibility === "Private" ? "amber" : "green"}>{resource.visibility}</TinyBadge>
                    <ArrowRight />
                  </Link>
                ))}
                {resources.length === 0 ? <ProjectEmpty label="No resources are linked to this project." /> : null}
              </div>
            ) : null}
          </section>
        </div>

        <ProjectObservationTable projectId={projectId} />

        <section className="project-panel">
          <SectionHeader title="Entities" description="Subjects, samples, observations, and derived research objects persisted in the Research Graph." />
          {fullEntities.error ? <ProjectApiError error={fullEntities.error} compact /> : null}
          {fullEntities.isFetching ? <div className="loading-state">Loading complete entity list…</div> : null}
          {entities ? (
            <div className="record-table-wrap project-table-wrap">
              <table className="simple-table project-table">
                <thead><tr><th>Entity</th><th>Category</th><th>Kind</th><th>State</th><th>Created</th></tr></thead>
                <tbody>{entities.map((entity) => <tr key={entity.id}><td><strong>{entity.label}</strong><small className="cell-subline mono">{entity.id}</small></td><td>{entity.category}</td><td>{entity.kind}</td><td><StateBadge state={entity.state} /></td><td>{formatDate(entity.createdAt)}</td></tr>)}</tbody>
              </table>
              {entities.length === 0 ? <ProjectEmpty label="The live API returned no project entities." /> : null}
            </div>
          ) : null}
        </section>

        <section className="project-panel">
          <SectionHeader title="Activities" description="Experimental, import, analysis, and Agent runs with persisted provenance." />
          {fullActivities.error ? <ProjectApiError error={fullActivities.error} compact /> : null}
          {fullActivities.isFetching ? <div className="loading-state">Loading complete activity list…</div> : null}
          {activities ? (
            <div className="project-timeline">
              {activities.map((activity) => (
                <article key={activity.id}>
                  <span className="timeline-dot"><Activity /></span>
                  <div><strong>{activity.label}</strong><small>{activity.kind} · {activity.id}</small></div>
                  <StateBadge state={activity.status} />
                  <time>{formatDate(activity.startedAt)}</time>
                </article>
              ))}
              {activities.length === 0 ? <ProjectEmpty label="The live API returned no project activities." /> : null}
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}

function Metric({ icon, label, value, loading }: { icon: React.ReactNode; label: string; value: string; loading: boolean }) {
  return <article className="project-metric"><span>{icon}</span><div><small>{label}</small><strong>{loading ? "…" : value}</strong></div></article>;
}

function ContextPackDetails({ context }: { context: ProjectContextPack }) {
  return (
    <div className="context-pack-grid">
      <div className="context-summary"><GitBranch /><div><strong>Persisted context coverage</strong><p>{context.studies.length} studies, {context.entities.length} entities, {context.activities.length} activities, {context.associations.length} associations, and {context.evidence.length} evidence items.</p></div></div>
      <div><strong>Execution provenance</strong><ul><li>{context.activityIo.length} activity input/output links</li><li>{context.activityActors.length} actor assignments</li><li>{context.associationEvidence.length} evidence links</li></ul></div>
      <div><strong>Data products</strong><ul><li>{context.resources.length} resources</li><li>{context.resourceRevisions.length} immutable revisions</li><li>{context.resourceGraphBindings.length} graph bindings</li></ul></div>
      <dl className="context-provenance"><div><dt>Project</dt><dd>{context.project.id}</dd></div><div><dt>Response</dt><dd>{context.truncated ? "Truncated by server limit" : "Complete within server limit"}</dd></div></dl>
    </div>
  );
}

function StudyList({ rows }: { rows: JsonRecord[] }) {
  if (rows.length === 0) return <ProjectEmpty label="The context pack contains no study records." />;
  return <div className="project-object-list">{rows.map((study, index) => {
    const id = text(study.id, `study-${index + 1}`);
    return <div className="project-object-static" key={id}><span className="project-object-icon"><Beaker /></span><span><strong>{text(study.label ?? study.name, id)}</strong><small>{text(study.description, text(study.kind, "Study"))}</small></span><TinyBadge tone="blue">study</TinyBadge></div>;
  })}</div>;
}

function StateBadge({ state }: { state: string }) {
  const normalized = state.toLowerCase();
  const tone = normalized === "validated" || normalized === "completed" || normalized === "available"
    ? "green"
    : normalized === "hypothesis" || normalized === "proposed"
      ? "amber"
      : normalized === "computed"
        ? "purple"
        : "blue";
  return <TinyBadge tone={tone}>{state || "unknown"}</TinyBadge>;
}

function ProjectEmpty({ label }: { label: string }) {
  return <div className="project-inline-empty"><ShieldAlert />{label}</div>;
}

function text(value: unknown, fallback = "—") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function formatDate(value: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
