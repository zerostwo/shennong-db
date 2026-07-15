import { redirect } from "next/navigation";
import { ChatView } from "@/components/chat-view";

export const dynamic = "force-dynamic";

export default async function Home() {
  const api = process.env.SHENNONG_API_INTERNAL_URL;
  if (api) {
    const response = await fetch(`${api}/api/v1/setup/status`, { cache: "no-store" });
    if (response.ok) {
      const payload = await response.json() as { needs_setup?: boolean; data?: { needs_setup?: boolean } };
      if (payload.data?.needs_setup ?? payload.needs_setup) redirect("/auth/sign-in");
    }
  }
  return <ChatView />;
}
