import { ChatView } from "@/components/chat-view";

export default async function ProjectChatThreadPage({ params }: { params: Promise<{ projectId: string; threadId: string }> }) {
  const { projectId, threadId } = await params;
  return <ChatView projectId={projectId} threadId={threadId} />;
}
