"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { getProject } from "@/lib/api/adapter";
import { AppShell, SectionHeader, TopBar } from "@/components/app-shell";
import { MemoryManager } from "@/components/memory-manager";
import { ProjectApiError } from "@/components/projects-view";
import { ProjectTabs } from "@/components/project-tabs";

export function ProjectMemoryView({ projectId }: { projectId: string }) {
  const project = useQuery({ queryKey: ["projects", projectId], queryFn: () => getProject(projectId) });
  return <AppShell active="projects"><TopBar title={project.data ? `${project.data.name} Memory` : "Project Memory"} description="Project-only context used alongside your active global memories." search={false} action={<Link className="outline-button" href={`/projects/${encodeURIComponent(projectId)}`}><ArrowLeft />Back to workspace</Link>} /><div className="workspace-page project-workspace-page"><ProjectTabs projectId={projectId} active="memory" />{project.error ? <ProjectApiError error={project.error} /> : null}<SectionHeader title="Project Memory" description="Persisted context for this Project. Archive entries when they should no longer guide its Agent chats." /><MemoryManager projectId={projectId} /></div></AppShell>;
}
