import { ProjectWorkspaceView } from "@/components/project-workspace-view";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectWorkspaceView projectId={projectId} />;
}
