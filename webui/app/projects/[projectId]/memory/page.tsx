import { ProjectMemoryView } from "@/components/project-memory-view";

export default async function ProjectMemoryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectMemoryView projectId={projectId} />;
}
