import { UploadView } from "@/components/upload-view";

export default async function ProjectUploadPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <UploadView projectId={projectId} returnTo={`/projects/${encodeURIComponent(projectId)}`} />;
}
