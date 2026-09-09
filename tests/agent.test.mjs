import test from "node:test";
import assert from "node:assert/strict";
import { intents, parseRequest, groundedReply } from "../server/domain/agent.mjs";
import { runAgentGraph } from "../server/domain/agentGraph.mjs";
import {
  NoopChatProvider,
  OllamaChatProvider,
  defaultChatProvider,
} from "../server/adapters/llm.mjs";
import { tracingEnabled, traced } from "../server/adapters/tracing.mjs";
import { sampleSearch } from "../server/domain/journeys.mjs";

// This file closes a real, pre-existing gap: agent.mjs had zero dedicated tests before this
// pass, even though it's wired into a live endpoint (POST /api/agent in router.mjs). It also
// covers this pass's new work: a pluggable chat-model provider (adapters/llm.mjs), an optional
// LangSmith tracing seam (adapters/tracing.mjs), and the LangGraph orchestration layer
// (domain/agentGraph.mjs) that composes them with agent.mjs's original, unchanged deterministic
// logic. None of these tests depend on a live model or network access -- the model-backed paths
// are exercised with an injected mock provider, exactly what runAgentGraph's `provider` param
// exists for. A separate manual script (scripts/llm-smoke-test.mjs) exercises a real local
// Ollama model once one is actually configured; it deliberately isn't part of this automated
// suite so CI never depends on that.

function realJourney() {
  return sampleSearch({ from: "sf", to: "oak", departure: "2026-06-01T18:00:00Z" }).journeys[0];
}

test("parseRequest extracts a budget, a priority and city ids from free text", () => {
  const parsed = parseRequest(
    "I want the cheapest way from Los Angeles to San Jose under $40, no transfers",
  );
  assert.equal(parsed.intent, "plan");
  assert.equal(parsed.overrides.priority, "price");
  assert.equal(parsed.overrides.budgetCents, 4000);
  assert.equal(parsed.overrides.maxTransfers, 0);
  assert.equal(parsed.from, "la");
  assert.equal(parsed.to, "sj");
});

test("parseRequest classifies intent keywords independently of city/budget parsing", () => {
  assert.equal(parseRequest("how much will this cost me").intent, "cost");
  assert.equal(parseRequest("why is my train late").intent, "delay");
  assert.equal(parseRequest("which platform do I board at").intent, "boarding");
  assert.equal(parseRequest("can I get a refund").intent, "refund");
  assert.equal(parseRequest("please delete my sharing history").intent, "privacy");
  assert.equal(parseRequest("is there an elevator").intent, "accessibility");
});

test("groundedReply without a journey always asks the user to select one, regardless of intent", () => {
  const { reply, evidence } = groundedReply("cost", {
    journey: null,
    preferences: {},
    parsed: parseRequest("cost?"),
  });
  assert.match(reply, /Select or save a journey first/);
  assert.deepEqual(evidence, []);
});

test("groundedReply for 'plan' returns an apply-search action carrying the parsed overrides", () => {
  const parsed = parseRequest("cheapest way, no transfers, under $40");
  const { reply, actions } = groundedReply("plan", { journey: null, preferences: {}, parsed });
  assert.match(reply, /prepared routing preferences/);
  assert.equal(actions[0].type, "apply-search");
  assert.deepEqual(actions[0].payload, parsed);
});

test("groundedReply for 'cost' states the real recorded total and per-item breakdown", () => {
  const journey = realJourney();
  const { reply, evidence } = groundedReply("cost", {
    journey,
    preferences: {},
    parsed: parseRequest("cost?"),
  });
  const expectedTotal = (journey.price.totalCents / 100).toFixed(2);
  assert.ok(reply.includes(`$${expectedTotal}`), reply);
  assert.equal(evidence[0].journeyId, journey.id);
});

test("groundedReply appends the illustrative-sample disclosure for a sample journey, except for 'plan'", () => {
  const journey = realJourney();
  assert.equal(journey.dataMode, "illustrative");
  const cost = groundedReply("cost", { journey, preferences: {}, parsed: parseRequest("cost?") });
  assert.match(cost.reply, /This is a sample journey/);
  const plan = groundedReply("plan", {
    journey,
    preferences: {},
    parsed: parseRequest("plan a trip"),
  });
  assert.doesNotMatch(plan.reply, /This is a sample journey/);
});

test("groundedReply for 'delay' reports no confirmed disruption when the journey has no alerts", () => {
  const journey = realJourney();
  const { reply } = groundedReply("delay", {
    journey,
    preferences: {},
    parsed: parseRequest("why late?"),
  });
  assert.match(reply, /no confirmed disruption|Missing live information/);
});

test("runAgentGraph with no provider configured uses the Rules assistant path unchanged", async () => {
  const result = await runAgentGraph({
    input: "how much does this cost",
    journey: null,
    preferences: {},
    history: [],
  });
  assert.equal(result.mode, "Rules assistant");
  assert.equal(result.intent, "cost");
  assert.match(result.reply, /Select or save a journey first/);
});

test("runAgentGraph routes classification through a configured provider and labels the mode", async () => {
  const provider = {
    available: true,
    model: "mock-classify",
    async chat({ jsonSchema }) {
      assert.ok(jsonSchema, "classify step must request structured output");
      return JSON.stringify({ intent: "boarding" });
    },
  };
  const result = await runAgentGraph({
    input: "how much does this cost",
    journey: null,
    preferences: {},
    history: [],
    provider,
  });
  assert.equal(result.intent, "boarding");
  assert.equal(result.mode, "Ollama classify · mock-classify");
});

test("runAgentGraph falls back to the regex intent when the model returns an intent outside the fixed list", async () => {
  const provider = {
    available: true,
    model: "mock-bad",
    async chat({ jsonSchema }) {
      if (jsonSchema) return JSON.stringify({ intent: "not-a-real-intent" });
      return "unused";
    },
  };
  const result = await runAgentGraph({
    input: "why is this late",
    journey: null,
    preferences: {},
    history: [],
    provider,
  });
  assert.equal(result.intent, "delay");
  assert.match(result.mode, /unknown intent/);
});

test("runAgentGraph falls back to the regex intent when the provider throws during classification", async () => {
  const provider = {
    available: true,
    model: "mock-throws",
    async chat() {
      throw new Error("network exploded");
    },
  };
  const result = await runAgentGraph({
    input: "why is this late",
    journey: null,
    preferences: {},
    history: [],
    provider,
  });
  assert.equal(result.intent, "delay");
  assert.match(result.mode, /local model unavailable/);
});

test("runAgentGraph never lets a model invent a fact: an unfounded rewrite is rejected and the original grounded text ships", async () => {
  const journey = realJourney();
  const provider = {
    available: true,
    model: "mock-hallucinate",
    async chat({ jsonSchema }) {
      if (jsonSchema) return JSON.stringify({ intent: "cost" });
      return "Everything is free today, no charge at all!";
    },
  };
  const result = await runAgentGraph({
    input: "how much does this cost",
    journey,
    preferences: {},
    history: [],
    provider,
  });
  const expectedTotal = (journey.price.totalCents / 100).toFixed(2);
  assert.ok(result.reply.includes(`$${expectedTotal}`), result.reply);
  assert.doesNotMatch(result.mode, /composed/);
});

test("runAgentGraph accepts a rewrite that preserves every number from the grounded reply, and labels it composed", async () => {
  const journey = realJourney();
  const provider = {
    available: true,
    model: "mock-good",
    async chat({ jsonSchema, messages }) {
      if (jsonSchema) return JSON.stringify({ intent: "cost" });
      return messages[1].content.replace("recorded door-to-door total", "total fare");
    },
  };
  const result = await runAgentGraph({
    input: "how much does this cost",
    journey,
    preferences: {},
    history: [],
    provider,
  });
  assert.match(result.mode, /composed/);
  assert.match(result.reply, /total fare/);
  const expectedTotal = (journey.price.totalCents / 100).toFixed(2);
  assert.ok(result.reply.includes(`$${expectedTotal}`), result.reply);
});

test("runAgentGraph keeps the original grounded reply, without crashing, if composeReply itself throws", async () => {
  const journey = realJourney();
  const provider = {
    available: true,
    model: "mock-compose-throws",
    async chat({ jsonSchema }) {
      if (jsonSchema) return JSON.stringify({ intent: "cost" });
      throw new Error("compose network exploded");
    },
  };
  const result = await runAgentGraph({
    input: "how much does this cost",
    journey,
    preferences: {},
    history: [],
    provider,
  });
  const expectedTotal = (journey.price.totalCents / 100).toFixed(2);
  assert.ok(result.reply.includes(`$${expectedTotal}`), result.reply);
  assert.doesNotMatch(result.mode, /composed/);
});

test("defaultChatProvider returns the no-op provider unless both OLLAMA_BASE_URL and OLLAMA_MODEL are set", () => {
  assert.equal(defaultChatProvider({}).available, false);
  assert.equal(defaultChatProvider({ OLLAMA_BASE_URL: "http://x" }).available, false);
  assert.equal(defaultChatProvider({ OLLAMA_MODEL: "m" }).available, false);
  const p = defaultChatProvider({ OLLAMA_BASE_URL: "http://x:11434", OLLAMA_MODEL: "m" });
  assert.equal(p.available, true);
  assert.ok(p instanceof OllamaChatProvider);
});

test("NoopChatProvider.chat always rejects, never silently returns a fabricated answer", async () => {
  await assert.rejects(() => new NoopChatProvider().chat({ messages: [] }));
});

test("OllamaChatProvider refuses to construct without both a baseUrl and a model", () => {
  assert.throws(() => new OllamaChatProvider({ baseUrl: "http://x" }));
  assert.throws(() => new OllamaChatProvider({ model: "m" }));
  assert.doesNotThrow(() => new OllamaChatProvider({ baseUrl: "http://x", model: "m" }));
});

// OLLAMA_NUM_CTX exists because a real local Llama 3.2 3B model, run against this project on a
// 3.8GB-RAM host, failed outright ("model requires more system memory than is available") at
// Ollama's default context size and only completed a chat request once the context window was
// capped -- this isn't a hypothetical knob, it's what made the real smoke test in
// scripts/llm-smoke-test.mjs pass on that machine. See docs/adr/0008-real-llm-agent.md.
test("defaultChatProvider passes OLLAMA_NUM_CTX through to the provider as numCtx", () => {
  const withoutIt = defaultChatProvider({ OLLAMA_BASE_URL: "http://x:11434", OLLAMA_MODEL: "m" });
  assert.equal(withoutIt.numCtx, undefined);
  const withIt = defaultChatProvider({
    OLLAMA_BASE_URL: "http://x:11434",
    OLLAMA_MODEL: "m",
    OLLAMA_NUM_CTX: "256",
  });
  assert.equal(withIt.numCtx, 256);
});

test("OllamaChatProvider.chat only sends num_ctx when the provider was configured with one", async (t) => {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    const bytes = Buffer.from(JSON.stringify({ message: { content: "ok" } }));
    return {
      ok: true,
      headers: { get: () => null },
      body: {
        async *[Symbol.asyncIterator]() {
          yield bytes;
        },
      },
    };
  });

  const plain = new OllamaChatProvider({ baseUrl: "http://x:11434", model: "m" });
  await plain.chat({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(bodies[0].options.num_ctx, undefined);

  const capped = new OllamaChatProvider({ baseUrl: "http://x:11434", model: "m", numCtx: 256 });
  await capped.chat({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(bodies[1].options.num_ctx, 256);
});

// This is deliberately NOT `format: <schema object>` (Ollama's newer structured-outputs
// feature) -- see the long comment on OllamaChatProvider.chat() in server/adapters/llm.mjs for
// why: that mode 400s outright against a real Ollama 0.3.14 install, confirmed by hand, not
// assumed. Sending the broadly-supported `format: "json"` string plus the schema as plain text
// works on old and new Ollama versions alike, and doesn't weaken the safety property because
// agentGraph.mjs's classifyIntent re-checks the answer against the closed `intents` list
// regardless of which format mode produced it.
test('OllamaChatProvider.chat sends format:"json" (not a schema object) and embeds the schema as text when jsonSchema is given', async (t) => {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    const bytes = Buffer.from(JSON.stringify({ message: { content: '{"intent":"cost"}' } }));
    return {
      ok: true,
      headers: { get: () => null },
      body: {
        async *[Symbol.asyncIterator]() {
          yield bytes;
        },
      },
    };
  });

  const provider = new OllamaChatProvider({ baseUrl: "http://x:11434", model: "m" });
  const schema = { type: "object", properties: { intent: { type: "string" } } };
  const content = await provider.chat({
    messages: [{ role: "user", content: "how much?" }],
    jsonSchema: schema,
  });

  assert.equal(content, '{"intent":"cost"}');
  assert.equal(bodies[0].format, "json");
  assert.equal(bodies[0].messages.length, 2);
  assert.equal(bodies[0].messages[0].content, "how much?");
  assert.equal(bodies[0].messages[1].role, "system");
  assert.ok(bodies[0].messages[1].content.includes(JSON.stringify(schema)));
});

test("tracingEnabled requires both LANGSMITH_TRACING=true and an API key -- either alone is off", () => {
  assert.equal(tracingEnabled({}), false);
  assert.equal(tracingEnabled({ LANGSMITH_TRACING: "true" }), false);
  assert.equal(tracingEnabled({ LANGSMITH_API_KEY: "k" }), false);
  assert.equal(tracingEnabled({ LANGSMITH_TRACING: "true", LANGSMITH_API_KEY: "k" }), true);
});

test("traced() is a true no-op (same function reference) when tracing is disabled", () => {
  const fn = async (x) => x;
  assert.equal(traced("step", fn, {}), fn);
});

test("traced() wraps the function (a different, LangSmith-instrumented reference) only when tracing is enabled", () => {
  const fn = async (x) => x;
  const wrapped = traced("step", fn, { LANGSMITH_TRACING: "true", LANGSMITH_API_KEY: "k" });
  assert.notEqual(wrapped, fn);
});

test("intents is a fixed, closed list -- the model can never classify outside of it", () => {
  assert.ok(Array.isArray(intents));
  assert.ok(intents.length > 0);
  assert.ok(intents.every((i) => typeof i === "string"));
});
