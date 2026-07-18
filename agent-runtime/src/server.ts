import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { pathToFileURL } from "node:url";
import { Type, type Model } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  createProviderFetchGuard,
  type ProviderFetchPolicy,
} from "./fetch-guard.js";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_MESSAGES = 200;
const MAX_CONTENT_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const FINAL_RESPONSE_RECOVERY_PROMPT = [
  "Your previous turn completed governed tool use but did not include a visible final answer.",
  "Using only the tool results already present in this session, answer the original user request now.",
  "Do not call another tool. Keep the answer concise, state the evidence and sample sizes, and preserve any uncertainty.",
].join(" ");
const TOOL_PROTOCOL_RECOVERY_PROMPT = [
  "Your previous response printed tool-call markup instead of executing a native function call.",
  "Do not repeat or quote that markup. Invoke the needed governed tool through the provider's native function-calling interface now.",
  "If you cannot use native function calling, say that the selected model is not tool-call compatible and make no data claim.",
].join(" ");
const TOOL_PROTOCOL_FAILURE_MESSAGE =
  "The selected model emitted tool-call markup instead of a native function call, so ShennongDB did not execute that request and no data conclusion was generated. Retry the message or choose a model with reliable native tool calling.";

type ProviderInput = {
  kind: "openai" | "deepseek" | "ollama" | "openai-compatible";
  base_url: string;
  model: string;
  api_key?: string;
  capabilities?: string[];
  context_window?: number;
  max_tokens?: number;
};

type MessageInput = {
  role: "user" | "assistant";
  content: string;
};

type ToolPolicy = {
  allow_private: boolean;
  allow_data_write: boolean;
  is_admin: boolean;
};

type RunInput = {
  run_id: string;
  provider: ProviderInput;
  provider_id: string;
  system_prompt: string;
  messages: MessageInput[];
  thinking_level?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  project_id?: string;
  tool_callback_token?: string;
  tools_enabled: boolean;
  tool_policy: ToolPolicy;
  attached_upload_ids: string[];
  timeout_ms?: number;
};

type JsonObject = Record<string, unknown>;

const providerFetchContext = new AsyncLocalStorage<ProviderFetchPolicy>();
let providerFetchGuardInstalled = false;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function authorize(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("Bearer ") || secret.length < 32) return false;
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

function cleanLine(value: string): string {
  return value.replaceAll("\0", "").trim();
}

export function buildPrompt(messages: MessageInput[]): string {
  const history = messages.slice(0, -1).map((message) => {
    const role = message.role === "assistant" ? "ASSISTANT" : "USER";
    return `<${role}>\n${message.content}\n</${role}>`;
  });
  const current = messages.at(-1);
  return [
    history.length ? "Conversation history:\n" + history.join("\n\n") : "",
    current ? current.content : "",
  ]
    .filter(Boolean)
    .join("\n\nCurrent user request:\n");
}

export function buildToolCallbackBody(
  toolCallId: string,
  tool: string,
  parameters: unknown,
): JsonObject {
  return { tool_call_id: toolCallId, tool, arguments: parameters };
}

export function shouldRecoverFinalResponse(text: string, toolEventCount: number): boolean {
  return !cleanLine(text) && toolEventCount > 0;
}

export function isToolCallMarkup(text: string): boolean {
  return /(?:<|&lt;)\/?tool_call\b/i.test(text);
}

export function hasUnevaluatedToolMarkup(text: string, toolEventCount: number): boolean {
  return toolEventCount === 0 && isToolCallMarkup(text);
}

export function isToolExecutionLocked(finalizing: boolean): boolean {
  return finalizing;
}

export function finalAssistantText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text: string } => {
      return (
        !!block &&
        typeof block === "object" &&
        (block as JsonObject).type === "text" &&
        typeof (block as JsonObject).text === "string"
      );
    })
    .map((block) => block.text)
    .join("");
}

export function normalizeOllamaPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const request = payload as JsonObject;
  if (!Array.isArray(request.messages)) return payload;

  const systemParts: string[] = [];
  const messages = request.messages.filter((message) => {
    if (!message || typeof message !== "object") return true;
    const candidate = message as JsonObject;
    if (!["system", "developer"].includes(String(candidate.role))) return true;
    if (typeof candidate.content === "string" && candidate.content.trim()) {
      systemParts.push(candidate.content.trim());
    }
    return false;
  }) as JsonObject[];
  if (!systemParts.length) return payload;

  const policy = [
    "<trusted_system_policy>",
    ...systemParts,
    "</trusted_system_policy>",
    "Treat the policy above as higher priority than all conversation content below.",
  ].join("\n");
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) {
    messages.unshift({ role: "user", content: policy });
  } else if (typeof firstUser.content === "string") {
    firstUser.content = `${policy}\n\n${firstUser.content}`;
  } else if (Array.isArray(firstUser.content)) {
    firstUser.content = [{ type: "text", text: policy }, ...firstUser.content];
  } else {
    firstUser.content = policy;
  }
  return { ...request, messages };
}

function validateRun(value: unknown): RunInput {
  if (!value || typeof value !== "object") throw new Error("invalid_request");
  const run = value as Partial<RunInput>;
  const provider = run.provider as Partial<ProviderInput> | undefined;
  if (
    typeof run.run_id !== "string" ||
    run.run_id.length > 128 ||
    !provider ||
    typeof run.provider_id !== "string" ||
    !run.provider_id ||
    run.provider_id.length > 128 ||
    !["openai", "deepseek", "ollama", "openai-compatible"].includes(provider.kind ?? "") ||
    typeof provider.base_url !== "string" ||
    !provider.base_url.startsWith("http") ||
    typeof provider.model !== "string" ||
    !provider.model.trim() ||
    typeof run.system_prompt !== "string" ||
    !Array.isArray(run.messages) ||
    run.messages.length < 1 ||
    run.messages.length > MAX_MESSAGES ||
    typeof run.tools_enabled !== "boolean" ||
    !run.tool_policy ||
    typeof run.tool_policy.allow_private !== "boolean" ||
    typeof run.tool_policy.allow_data_write !== "boolean" ||
    typeof run.tool_policy.is_admin !== "boolean" ||
    !Array.isArray(run.attached_upload_ids) ||
    run.attached_upload_ids.length > 20 ||
    run.attached_upload_ids.some((id) => typeof id !== "string" || !id || id.length > 128)
  ) {
    throw new Error("invalid_request");
  }
  let contentBytes = Buffer.byteLength(run.system_prompt);
  for (const message of run.messages) {
    if (
      !message ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string"
    ) {
      throw new Error("invalid_request");
    }
    contentBytes += Buffer.byteLength(message.content);
  }
  if (contentBytes > MAX_CONTENT_BYTES) throw new Error("request_too_large");
  if (provider.api_key !== undefined && provider.api_key.length > 8192) {
    throw new Error("invalid_request");
  }
  return run as RunInput;
}

function callbackTool(
  name: string,
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
  run: RunInput,
  isFinalizing: () => boolean,
) {
  return defineTool({
    name,
    label,
    description,
    parameters,
    async execute(toolCallId, params, signal) {
      if (isToolExecutionLocked(isFinalizing())) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Governed tools are locked while the Agent is producing its final answer.",
            },
          ],
          details: { code: "tool_execution_locked", status: 0 },
          isError: true,
        };
      }
      const callbackUrl = process.env.SHENNONG_AGENT_TOOL_CALLBACK_URL;
      if (!callbackUrl || !run.tool_callback_token) {
        return {
          content: [{ type: "text" as const, text: "This governed tool is unavailable for this run." }],
          details: { code: "tool_callback_unavailable", status: 0 },
          isError: true,
        };
      }
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${run.tool_callback_token}`,
          "content-type": "application/json",
          "x-shennong-agent-run": run.run_id,
          "x-shennong-agent-runtime": process.env.SHENNONG_AGENT_RUNTIME_SECRET ?? "",
        },
        body: JSON.stringify(buildToolCallbackBody(toolCallId, name, params)),
        ...(signal ? { signal } : {}),
      });
      const text = (await response.text()).slice(0, 64 * 1024);
      if (!response.ok) {
        return {
          content: [{ type: "text" as const, text: `Governed tool failed (${response.status}).` }],
          details: { code: "tool_callback_failed", status: response.status },
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text }],
        details: { code: "ok", status: response.status },
      };
    },
  });
}

function governedTools(run: RunInput, isFinalizing: () => boolean) {
  if (!run.tools_enabled) return [];
  const tools = [
    callbackTool(
      "discover_resources",
      "Discover Resources",
      "Find governed ShennongDB Resources relevant to a biomedical question. The catalog indexes Resource metadata, not every stored gene: search with broad cohort or modality terms, and if a gene-specific search is empty retry once without q before concluding that data is absent.",
      Type.Object({ q: Type.Optional(Type.String()) }),
      run,
      isFinalizing,
    ),
    callbackTool(
      "inspect_resource",
      "Inspect Resource",
      "Inspect a Resource contract before querying, including declared operations and context axes.",
      Type.Object({ resource: Type.String() }),
      run,
      isFinalizing,
    ),
    callbackTool(
      "query_resource",
      "Query Resource",
      "Execute one declared read-only operation against a governed Resource.",
      Type.Object({
        resource: Type.String(),
        operation: Type.String(),
        feature: Type.String(),
        context: Type.Optional(Type.Record(Type.String(), Type.String())),
        limit: Type.Optional(Type.Number()),
      }),
      run,
      isFinalizing,
    ),
    callbackTool(
      "compare_expression",
      "Compare Expression",
      "Compare all stored expression values for one gene between exact tumor and normal sample groups.",
      Type.Object({
        resource: Type.String(),
        feature: Type.String(),
        context: Type.Record(Type.String(), Type.String()),
        tumor_sample_type: Type.Optional(Type.String()),
        normal_sample_type: Type.Optional(Type.String()),
      }),
      run,
      isFinalizing,
    ),
    callbackTool(
      "resolve_gene",
      "Resolve Gene",
      "Resolve a gene symbol or stable identifier against authorized ShennongDB Resources.",
      Type.Object({
        query: Type.String(),
        resources: Type.Optional(Type.Array(Type.String())),
      }),
      run,
      isFinalizing,
    ),
    callbackTool(
      "list_curated_data_providers",
      "List Curated Data Providers",
      "List built-in governed data providers that an administrator can install.",
      Type.Object({}),
      run,
      isFinalizing,
    ),
  ];
  if (run.tool_policy.allow_private) {
    tools.push(
      callbackTool(
        "inspect_uploaded_data",
        "Inspect Uploaded Data",
        "Inspect metadata for a server-verified upload attached to this user message.",
        Type.Object({ upload_id: Type.String() }),
        run,
        isFinalizing,
      ),
    );
  }
  if (run.tool_policy.allow_private && run.tool_policy.allow_data_write) {
    tools.push(
      callbackTool(
        "register_uploaded_data",
        "Register Uploaded Data",
        "Register attached uploads as one private governed raw Resource after explicit confirmation.",
        Type.Object({
          upload_ids: Type.Array(Type.String()),
          resource_id: Type.String(),
          name: Type.String(),
          description: Type.Optional(Type.String()),
          organism: Type.Optional(Type.String()),
          modality: Type.Optional(Type.String()),
          assay: Type.Optional(Type.String()),
          reference: Type.Optional(Type.String()),
          annotation: Type.Optional(Type.String()),
          format: Type.Optional(Type.String()),
        }),
        run,
        isFinalizing,
      ),
    );
  }
  if (run.tool_policy.is_admin && run.tool_policy.allow_data_write) {
    tools.push(
      callbackTool(
        "install_curated_data_provider",
        "Install Curated Data Provider",
        "Schedule installation of one built-in governed provider after explicit confirmation.",
        Type.Object({ name: Type.String() }),
        run,
        isFinalizing,
      ),
    );
  }
  return tools;
}

function customModel(provider: ProviderInput): Model<any> {
  return {
    id: provider.model,
    name: provider.model,
    api: "openai-completions",
    provider: provider.kind,
    baseUrl: provider.base_url.replace(/\/$/, ""),
    reasoning: provider.capabilities?.includes("thinking") ?? provider.kind === "deepseek",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: provider.context_window ?? 128_000,
    maxTokens: provider.max_tokens ?? 16_384,
  };
}

async function runAgentWithProviderContext(run: RunInput): Promise<JsonObject> {
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(run.provider.kind, run.provider.api_key || "ollama");
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  let model = modelRegistry.find(run.provider.kind, run.provider.model);
  const expectedBase = run.provider.base_url.replace(/\/$/, "");
  if (!model || model.baseUrl?.replace(/\/$/, "") !== expectedBase) {
    modelRegistry.registerProvider(run.provider.kind, {
      name: run.provider.kind,
      baseUrl: expectedBase,
      apiKey: run.provider.api_key || "ollama",
      api: "openai-completions",
      models: [customModel(run.provider)],
    });
    model = modelRegistry.find(run.provider.kind, run.provider.model);
  }
  if (!model) throw new Error("model_unavailable");

  const resourceLoader = new DefaultResourceLoader({
    cwd: "/tmp/shennong-agent-runtime",
    agentDir: "/tmp/shennong-agent-runtime",
    systemPromptOverride: () => run.system_prompt,
    extensionFactories:
      run.provider.kind === "ollama"
        ? [
            {
              name: "ollama-message-template-compat",
              factory(pi) {
                pi.on("before_provider_request", (event) =>
                  normalizeOllamaPayload(event.payload),
                );
              },
            },
          ]
        : [],
    skillsOverride: () => ({ skills: [], diagnostics: [] }),
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    promptsOverride: () => ({ prompts: [], diagnostics: [] }),
  });
  await resourceLoader.reload();
  let finalizing = false;
  const tools = governedTools(run, () => finalizing);
  const thinkingLevel = run.thinking_level ?? "off";
  const { session } = await createAgentSession({
    model,
    thinkingLevel,
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(),
    noTools: tools.length ? "builtin" : "all",
    tools: tools.map((tool) => tool.name),
    customTools: tools,
  });

  let streamedThinking = "";
  const toolEvents: JsonObject[] = [];
  const unsubscribe = session.subscribe((event: any) => {
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update?.type === "thinking_delta") streamedThinking += update.delta ?? "";
    } else if (event.type === "tool_execution_start") {
      toolEvents.push({
        id: event.toolCallId,
        tool: event.toolName,
        status: "running",
        arguments: event.args ?? {},
      });
    } else if (event.type === "tool_execution_end") {
      const current = toolEvents.find((item) => item.id === event.toolCallId);
      if (current) {
        current.status = event.isError ? "failed" : "completed";
        current.result = event.result ?? null;
      }
    }
  });

  const timeoutMs = Math.min(Math.max(run.timeout_ms ?? DEFAULT_TIMEOUT_MS, 1_000), 600_000);
  const deadline = Date.now() + timeoutMs;
  const promptUntilDeadline = async (prompt: string) => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("run_timeout");
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        session.prompt(prompt),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            void session.abort();
            reject(new Error("run_timeout"));
          }, remainingMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  try {
    await promptUntilDeadline(buildPrompt(run.messages));
    let assistants = session.messages.filter((message: any) => message.role === "assistant") as any[];
    let assistant = assistants.at(-1);
    if (!assistant) throw new Error("empty_response");
    if (["error", "aborted"].includes(assistant.stopReason)) {
      const diagnostic = cleanLine(String(assistant.errorMessage ?? "unknown provider error")).slice(0, 1000);
      process.stderr.write(`Pi provider run failed (${run.run_id}): ${diagnostic}\n`);
      throw new Error("provider_run_failed");
    }
    let text = finalAssistantText(assistant.content);
    if (hasUnevaluatedToolMarkup(text, toolEvents.length)) {
      await promptUntilDeadline(TOOL_PROTOCOL_RECOVERY_PROMPT);
      assistants = session.messages.filter((message: any) => message.role === "assistant") as any[];
      assistant = assistants.at(-1);
      if (!assistant || ["error", "aborted"].includes(assistant.stopReason)) {
        throw new Error("provider_run_failed");
      }
      text = finalAssistantText(assistant.content);
      if (hasUnevaluatedToolMarkup(text, toolEvents.length)) {
        text = TOOL_PROTOCOL_FAILURE_MESSAGE;
      }
    }
    if (shouldRecoverFinalResponse(text, toolEvents.length)) {
      finalizing = true;
      await promptUntilDeadline(FINAL_RESPONSE_RECOVERY_PROMPT);
      assistants = session.messages.filter((message: any) => message.role === "assistant") as any[];
      assistant = assistants.at(-1);
      if (!assistant || ["error", "aborted"].includes(assistant.stopReason)) {
        throw new Error("provider_run_failed");
      }
      text = finalAssistantText(assistant.content);
    }
    if (isToolCallMarkup(text)) {
      text = TOOL_PROTOCOL_FAILURE_MESSAGE;
    }
    if (!cleanLine(text)) throw new Error("empty_response");
    const reasoning = assistants
      .flatMap((message: any) => message.content)
      .filter((block: any) => block.type === "thinking")
      .map((block: any) => block.thinking ?? block.text ?? "")
      .filter(Boolean)
      .join("\n\n") || streamedThinking;
    const usage = assistants.reduce(
      (total, message: any) => {
        total.input += message.usage?.input ?? 0;
        total.output += message.usage?.output ?? 0;
        total.cacheRead += message.usage?.cacheRead ?? 0;
        total.cacheWrite += message.usage?.cacheWrite ?? 0;
        total.totalTokens += message.usage?.totalTokens ?? 0;
        total.providerCalls += 1;
        return total;
      },
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, providerCalls: 0 },
    );
    return {
      run_id: run.run_id,
      content: text,
      reasoning,
      tool_events: toolEvents,
      usage,
      stop_reason: assistant.stopReason ?? "stop",
      model: assistant.model ?? run.provider.model,
      provider: assistant.provider ?? run.provider.kind,
    };
  } finally {
    unsubscribe();
    session.dispose();
    authStorage.removeRuntimeApiKey(run.provider.kind);
  }
}

async function runAgent(run: RunInput): Promise<JsonObject> {
  return await providerFetchContext.run(
    { kind: run.provider.kind, baseUrl: run.provider.base_url },
    () => runAgentWithProviderContext(run),
  );
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

export function createRuntimeServer(secret: string) {
  if (!providerFetchGuardInstalled) {
    globalThis.fetch = createProviderFetchGuard({
      getPolicy: () => providerFetchContext.getStore(),
      getCallbackUrl: () => process.env.SHENNONG_AGENT_TOOL_CALLBACK_URL,
    });
    providerFetchGuardInstalled = true;
  }
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { status: "ok", runtime: "pi", version: "0.80.7" });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/runs") {
      json(response, 404, { error: { code: "not_found" } });
      return;
    }
    if (!authorize(request.headers.authorization, secret)) {
      json(response, 401, { error: { code: "unauthorized" } });
      return;
    }
    try {
      const run = validateRun(await readJson(request));
      const data = await runAgent(run);
      json(response, 200, { data });
    } catch (error) {
      const code = error instanceof Error ? cleanLine(error.message) : "runtime_failed";
      const status = code === "request_too_large" ? 413 : code === "invalid_request" ? 422 : 502;
      json(response, status, { error: { code } });
    }
  });
}

function main(): void {
  const secret = process.env.SHENNONG_AGENT_RUNTIME_SECRET ?? "";
  if (secret.length < 32) {
    process.stderr.write("SHENNONG_AGENT_RUNTIME_SECRET must contain at least 32 characters\n");
    process.exit(1);
  }
  const port = Number.parseInt(process.env.SHENNONG_AGENT_RUNTIME_PORT ?? "8002", 10);
  const server = createRuntimeServer(secret);
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`Shennong pi runtime listening on 127.0.0.1:${port}\n`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
