import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const api = process.env.SHENNONG_API_INTERNAL_URL;
  if (api) {
    const response = await fetch(`${api}/api/v1/setup/status`, { cache: "no-store" });
    if (response.ok && (await response.json()).needs_setup) redirect("/auth/sign-in");
  }
  redirect("/catalog");
}
