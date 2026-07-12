import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = Number(process.env.SHENNONG_MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024 * 1024);
const INTERNAL_API = process.env.SHENNONG_API_INTERNAL_URL ?? "http://127.0.0.1:8001";

type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: Context): Promise<Response> {
  const { path } = await context.params;
  const streamingUpload = request.method === "POST" && path.length === 1 && path[0] === "uploads";
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  const requestLimit = streamingUpload ? MAX_UPLOAD_BYTES : MAX_REQUEST_BYTES;
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > requestLimit) {
    return Response.json({ error: "request body too large" }, { status: 413 });
  }

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : streamingUpload
      ? request.body
      : await request.arrayBuffer();
  if (!streamingUpload && body instanceof ArrayBuffer && body.byteLength > requestLimit) {
    return Response.json({ error: "request body too large" }, { status: 413 });
  }

  const target = new URL(`/api/v1/${path.join("/")}${request.nextUrl.search}`, INTERNAL_API);
  const headers = new Headers(request.headers);
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("expect");
  headers.delete("host");
  headers.delete("transfer-encoding");

  let response: Response;
  try {
    const init: RequestInit & { duplex?: "half" } = {
      method,
      headers,
      body,
      redirect: "manual",
      signal: request.signal,
    };
    if (streamingUpload) init.duplex = "half";
    response = await fetch(target, init);
  } catch (error) {
    console.error("ShennongDB API proxy request failed", error);
    return Response.json({ code: "api_unavailable", message: "ShennongDB API is temporarily unavailable" }, { status: 503 });
  }

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
