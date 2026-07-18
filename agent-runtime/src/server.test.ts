import assert from "node:assert/strict";
import test from "node:test";
import {
  authorize,
  buildPrompt,
  buildToolCallbackBody,
  finalAssistantText,
  hasUnevaluatedToolMarkup,
  isToolCallMarkup,
  isToolExecutionLocked,
  normalizeOllamaPayload,
  shouldRecoverFinalResponse,
} from "./server.js";

test("runtime bearer authentication is exact", () => {
  const secret = "a".repeat(32);
  assert.equal(authorize(`Bearer ${secret}`, secret), true);
  assert.equal(authorize(`Bearer ${"b".repeat(32)}`, secret), false);
  assert.equal(authorize(undefined, secret), false);
});

test("conversation history and current request stay ordered", () => {
  const prompt = buildPrompt([
    { role: "user", content: "first" },
    { role: "assistant", content: "second" },
    { role: "user", content: "third" },
  ]);
  assert.match(prompt, /<USER>\nfirst/);
  assert.match(prompt, /<ASSISTANT>\nsecond/);
  assert.ok(prompt.endsWith("Current user request:\nthird"));
});

test("Ollama compatibility keeps trusted policy ahead of user content", () => {
  const payload = normalizeOllamaPayload({
    model: "hermes-qwythos9b:latest",
    messages: [
      { role: "system", content: "Use governed tools only." },
      { role: "user", content: "Find YTHDF2." },
    ],
  }) as { messages: Array<{ role: string; content: string }> };

  assert.deepEqual(payload.messages.map((message) => message.role), ["user"]);
  const message = payload.messages[0];
  assert.ok(message);
  assert.match(message.content, /^<trusted_system_policy>/);
  assert.match(message.content, /Use governed tools only/);
  assert.match(message.content, /Find YTHDF2\.$/);
});

test("tool callback body contains no caller-controlled capability context", () => {
  assert.deepEqual(buildToolCallbackBody("call-1", "query_resource", { feature: "YTHDF2" }), {
    tool_call_id: "call-1",
    tool: "query_resource",
    arguments: { feature: "YTHDF2" },
  });
});

test("an empty post-tool answer gets one final-response recovery turn", () => {
  assert.equal(shouldRecoverFinalResponse("", 1), true);
  assert.equal(shouldRecoverFinalResponse("  \n", 2), true);
  assert.equal(shouldRecoverFinalResponse("Visible answer", 1), false);
  assert.equal(shouldRecoverFinalResponse("", 0), false);
});

test("printed tool markup is not accepted as a completed answer", () => {
  assert.equal(
    hasUnevaluatedToolMarkup(
      '<tool_call name="discover_resources" params={"q":"YTHDF2"} />',
      0,
    ),
    true,
  );
  assert.equal(
    hasUnevaluatedToolMarkup('<tool_call>{"name":"discover_resources"}</tool_call>', 0),
    true,
  );
  assert.equal(hasUnevaluatedToolMarkup("Visible answer", 0), false);
  assert.equal(hasUnevaluatedToolMarkup("<tool_call>{}</tool_call>", 1), false);
  assert.equal(isToolCallMarkup("<tool_call>{}</tool_call>"), true);
  assert.equal(isToolCallMarkup("I will call it now.\n```\n<tool_call>{}</tool_call>\n```"), true);
  assert.equal(isToolCallMarkup("&lt;tool_call name=\"query_resource\" /&gt;"), true);
  assert.equal(isToolCallMarkup("A normal biomedical answer"), false);
});

test("final-answer recovery locks governed tools in code", () => {
  assert.equal(isToolExecutionLocked(false), false);
  assert.equal(isToolExecutionLocked(true), true);
});

test("final answer text comes only from the latest persisted assistant message", () => {
  const latest = finalAssistantText([{ type: "thinking", thinking: "old intermediate text" }]);
  assert.equal(latest, "");
  assert.equal(shouldRecoverFinalResponse(latest, 1), true);
  assert.equal(
    finalAssistantText([
      { type: "thinking", thinking: "analysis" },
      { type: "text", text: "Final answer" },
    ]),
    "Final answer",
  );
});
