export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INTERNAL_API = process.env.SHENNONG_API_INTERNAL_URL ?? "http://127.0.0.1:8001";

export async function GET(request: Request): Promise<Response> {
  try {
    const response = await fetch(new URL("/healthz", INTERNAL_API), {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: request.signal,
    });
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    console.error("ShennongDB health proxy request failed", error);
    return Response.json(
      { code: "api_unavailable", message: "ShennongDB API is temporarily unavailable" },
      { status: 503 },
    );
  }
}
