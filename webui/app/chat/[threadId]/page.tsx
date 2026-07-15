import { ChatView } from "@/components/chat-view";

export default async function ChatPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  return <ChatView threadId={threadId} />;
}
