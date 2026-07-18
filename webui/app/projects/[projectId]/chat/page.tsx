import { ChatView } from "@/components/chat-view";

export default async function ProjectChatPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ChatView projectId={projectId} />;
}
