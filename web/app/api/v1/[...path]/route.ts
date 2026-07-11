import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 1024 * 1024;
const INTERNAL_API = process.env.SHENNONG_API_INTERNAL_URL ?? "http://127.0.0.1:8001";

type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: Context): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "request body too large" }, { status: 413 });
  }

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  if (body && body.byteLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "request body too large" }, { status: 413 });
  }

  const { path } = await context.params;
  const target = new URL(`/api/v1/${path.join("/")}${request.nextUrl.search}`, INTERNAL_API);
  const headers = new Headers(request.headers);
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("host");

  const response = await fetch(target, {
    method,
    headers,
    body,
    redirect: "manual",
    signal: request.signal,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
