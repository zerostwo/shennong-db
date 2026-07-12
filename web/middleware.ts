import { NextRequest, NextResponse } from "next/server";

const API = process.env.SHENNONG_API_INTERNAL_URL ?? "http://127.0.0.1:8001";

export async function middleware(request: NextRequest) {
  let session: { authenticated?: boolean; role?: string } = {};
  try {
    const response = await fetch(`${API}/api/v1/auth/session`, { headers: { cookie: request.headers.get("cookie") ?? "", accept: "application/json" }, cache: "no-store" });
    if (response.ok) {
      const body = await response.json() as { data?: typeof session } & typeof session;
      session = body.data ?? body;
    }
  } catch { /* An unavailable identity service is unauthenticated, never authorized. */ }
  if (!session.authenticated) {
    const url = new URL("/auth/sign-in", request.url);
    url.searchParams.set("returnTo", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  if (request.nextUrl.pathname.startsWith("/admin") && session.role !== "admin") return NextResponse.redirect(new URL("/access-denied", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/console/:path*", "/admin/:path*"] };
