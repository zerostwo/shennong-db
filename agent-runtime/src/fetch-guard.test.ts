import assert from "node:assert/strict";
import test from "node:test";
import {
  createProviderFetchGuard,
  isPublicAddress,
  type FetchTransport,
  type ProviderFetchPolicy,
  type ResolveHost,
} from "./fetch-guard.js";

const publicResolver: ResolveHost = async () => [{ address: "8.8.8.8", family: 4 }];
const okTransport: FetchTransport = async () => new Response("ok", { status: 200 });

function guard(
  policy: ProviderFetchPolicy | undefined,
  options: {
    resolveHost?: ResolveHost;
    transport?: FetchTransport;
    callbackUrl?: string;
  } = {},
): typeof fetch {
  return createProviderFetchGuard({
    getPolicy: () => policy,
    getCallbackUrl: () => options.callbackUrl,
    resolveHost: options.resolveHost ?? publicResolver,
    transport: options.transport ?? okTransport,
  });
}

test("public address classification rejects local and special ranges", () => {
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("10.1.2.3"), false);
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("169.254.169.254"), false);
  assert.equal(isPublicAddress("::1"), false);
  assert.equal(isPublicAddress("2001:db8::1"), false);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("remote provider fetch uses HTTPS, re-resolves public IP, and disables redirects", async () => {
  let transportCalled = false;
  const fetch = guard(
    { kind: "deepseek", baseUrl: "https://api.deepseek.com/v1" },
    {
      transport: async (request, address) => {
        transportCalled = true;
        assert.equal(request.redirect, "manual");
        assert.deepEqual(address, { address: "8.8.8.8", family: 4 });
        return new Response("ok", { status: 200 });
      },
    },
  );

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    body: "{}",
  });
  assert.equal(response.status, 200);
  assert.equal(transportCalled, true);

  const rootBaseResponse = await guard({
    kind: "openai-compatible",
    baseUrl: "https://models.example.com",
  })("https://models.example.com/chat/completions");
  assert.equal(rootBaseResponse.status, 200);
});

test("remote provider rejects HTTP, private DNS answers, and paths outside its base", async () => {
  const privateResolver: ResolveHost = async () => [{ address: "192.168.1.20", family: 4 }];
  await assert.rejects(
    guard({ kind: "openai-compatible", baseUrl: "http://api.example.com/v1" })(
      "http://api.example.com/v1/chat/completions",
    ),
    /provider_https_required/,
  );
  await assert.rejects(
    guard(
      { kind: "openai-compatible", baseUrl: "https://api.example.com/v1" },
      { resolveHost: privateResolver },
    )("https://api.example.com/v1/chat/completions"),
    /provider_host_not_public/,
  );
  await assert.rejects(
    guard({ kind: "openai-compatible", baseUrl: "https://api.example.com/v1" })(
      "https://api.example.com/admin",
    ),
    /provider_target_outside_base/,
  );
});

test("Ollama is limited to the fixed local v1 endpoint", async () => {
  const localResolver: ResolveHost = async () => [{ address: "172.17.0.1", family: 4 }];
  const response = await guard(
    { kind: "ollama", baseUrl: "http://host.docker.internal:11434/v1" },
    { resolveHost: localResolver },
  )("http://host.docker.internal:11434/v1/chat/completions");
  assert.equal(response.status, 200);

  await assert.rejects(
    guard({ kind: "ollama", baseUrl: "http://host.docker.internal:8080/v1" })(
      "http://host.docker.internal:8080/v1/chat/completions",
    ),
    /ollama_url_not_allowed/,
  );
  await assert.rejects(
    guard({ kind: "ollama", baseUrl: "http://example.com:11434/v1" })(
      "http://example.com:11434/v1/chat/completions",
    ),
    /ollama_url_not_allowed/,
  );
});

test("redirect responses fail closed", async () => {
  const fetch = guard(
    { kind: "deepseek", baseUrl: "https://api.deepseek.com/v1" },
    {
      transport: async () =>
        new Response(null, {
          status: 307,
          headers: { location: "http://127.0.0.1:11434/v1" },
        }),
    },
  );
  await assert.rejects(
    fetch("https://api.deepseek.com/v1/chat/completions"),
    /provider_redirect_blocked/,
  );
});

test("only the fixed loopback tool callback bypasses provider policy", async () => {
  const callbackUrl = "http://127.0.0.1:8001/api/v1/internal/agent/tools";
  const response = await guard(undefined, { callbackUrl })(callbackUrl, { method: "POST" });
  assert.equal(response.status, 200);

  await assert.rejects(
    guard(undefined, { callbackUrl: "http://127.0.0.1:9000/tools" })(
      "http://127.0.0.1:9000/tools",
    ),
    /tool_callback_url_not_allowed/,
  );
});
