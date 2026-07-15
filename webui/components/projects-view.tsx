"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, FolderKanban, Plus, Search, ShieldCheck, Users } from "lucide-react";
import {
  createProject,
  listProjects,
  ShennongApiError,
  type ProjectRecord,
} from "@/lib/api/adapter";
import { AppShell, EmptyState, SectionHeader, TinyBadge, TopBar } from "./app-shell";

const projectKeys = { all: ["projects"] as const };

export function ProjectsView() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const projects = useQuery({ queryKey: projectKeys.all, queryFn: listProjects });
  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      setCreating(false);
      router.push(`/projects/${encodeURIComponent(project.id)}`);
    },
  });
  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects.data ?? [];
    return (projects.data ?? []).filter((project) =>
      `${project.name} ${project.description} ${project.ownerUserId}`.toLowerCase().includes(needle),
    );
  }, [projects.data, query]);

  function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createMutation.mutate({
      name: String(form.get("name") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      visibility: form.get("visibility") === "public" ? "public" : "private",
    });
  }

  const error = projects.error ?? createMutation.error;
  return (
    <AppShell active="projects">
      <TopBar
        title="Projects"
        description="Private research workspaces that connect studies, experiments, analyses, and BioGraph evidence."
        search={false}
        action={<button className="primary-button" onClick={() => setCreating(true)}><Plus />New project</button>}
      />
      <div className="workspace-page projects-page">
        <SectionHeader
          title="Research projects"
          description="Every project is backed by the live ShennongDB API; this page does not create browser-local records."
        />
        <div className="workspace-toolbar projects-toolbar">
          <label className="filter-search">
            <Search />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects…"
            />
          </label>
          <TinyBadge tone="green">Live API</TinyBadge>
        </div>
        {error ? <ProjectApiError error={error} /> : null}
        {projects.isPending ? <div className="loading-state">Loading projects from ShennongDB…</div> : null}
        {!projects.isPending && !error && visibleProjects.length === 0 ? (
          <EmptyState
            title={query ? "No matching projects" : "No projects yet"}
            description={query ? "The live API returned no project matching this search." : "Create the first API-backed research workspace."}
            action={!query ? <button className="primary-button" onClick={() => setCreating(true)}><Plus />New project</button> : undefined}
          />
        ) : null}
        {visibleProjects.length > 0 ? (
          <div className="project-card-grid">
            {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} />)}
          </div>
        ) : null}
      </div>
      {creating ? (
        <div className="modal-scrim" role="presentation" onMouseDown={() => setCreating(false)}>
          <form className="simple-dialog project-dialog" onSubmit={submitProject} onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-icon"><FolderKanban /></div>
            <h2>Create project</h2>
            <p>The project becomes the permission and provenance boundary for uploaded and Agent-acquired data.</p>
            {createMutation.error ? <ProjectApiError error={createMutation.error} compact /> : null}
            <label>Project name<input name="name" required minLength={3} autoFocus /></label>
            <label>Description<textarea name="description" rows={4} /></label>
            <label>Visibility<select name="visibility" defaultValue="private"><option value="private">Private</option><option value="public">Public</option></select></label>
            <div className="dialog-actions">
              <button type="button" className="outline-button" onClick={() => setCreating(false)}>Cancel</button>
              <button className="primary-button" disabled={createMutation.isPending}>{createMutation.isPending ? "Creating…" : "Create project"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}

function ProjectCard({ project }: { project: ProjectRecord }) {
  return (
    <article className="project-card">
      <div className="project-card-heading">
        <span className="project-card-icon"><FolderKanban /></span>
        <div>
          <h2>{project.name}</h2>
          <code>{project.id}</code>
        </div>
        <TinyBadge tone={project.visibility === "private" ? "amber" : "green"}>{project.visibility}</TinyBadge>
      </div>
      <p>{project.description || "No description provided."}</p>
      <div className="project-counts" aria-label="Project object counts">
        <span><Users />{count(project.counts.entities)} entities</span>
        <span><ShieldCheck />{count(project.counts.activities)} activities</span>
        <span><FolderKanban />{count(project.counts.resources)} resources</span>
      </div>
      <div className="project-card-footer">
        <span><CalendarClock />{formatDate(project.updatedAt || project.createdAt)}</span>
        <Link href={`/projects/${encodeURIComponent(project.id)}`}>Open workspace<ArrowRight /></Link>
      </div>
    </article>
  );
}

export function ProjectApiError({ error, compact = false }: { error: unknown; compact?: boolean }) {
  const notSupported = error instanceof ShennongApiError && error.code === "not_supported";
  const message = notSupported
    ? "This ShennongDB server has not enabled the Projects API. No local placeholder data was created."
    : error instanceof Error
      ? error.message
      : "The Projects API request failed.";
  return <div className={`error-banner ${compact ? "compact" : ""}`} role="alert">{message}</div>;
}

function count(value: number | undefined) {
  return value === undefined ? "—" : String(value);
}

function formatDate(value: string) {
  if (!value) return "No update timestamp";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}
