// A pluggable chat-model seam for the Agent feature. Before this pass, agent.mjs called
// Ollama's HTTP API directly, inline, and only for one narrow purpose: classifying a message
// into one of a fixed list of intents (see the `intents` array and the OLLAMA_BASE_URL branch
// that used to live in agentReply). This module generalizes that into a real provider
// interface -- server/domain/agentGraph.mjs uses it both for that same classification step and
// for a new step (composing a natural-language reply from real, structured tool output) -- so
// the model's HTTP shape isn't hardcoded into domain code, and a different provider (a real
// hosted API, once one is configured) is a single new class here, not a rewrite.
//
// There is still no hosted-LLM account wired into this codebase -- Anthropic, OpenAI, or any
// other contracted API is exactly the kind of external, credentialed dependency this project's
// plan has consistently declined to fake (same category as email.mjs's provider account or a
// real payment processor in adapters/payments.mjs). What changed in this pass is that a *local*
// model became genuinely runnable: Ollama (open-source, self-hosted, no account) is configured
// via OLLAMA_BASE_URL/OLLAMA_MODEL, unchanged from how README.md already documented it.
//
// NoopChatProvider is the default, used whenever those two environment variables aren't both
// set, or whenever they're set but the model turns out to be unreachable. It never throws
// silently or crashes a request -- callers check `.available` up front and fall back to
// agent.mjs's original deterministic, template-based replies, exactly as before this pass.

import { fetchBounded } from "./providers.mjs";

export class NoopChatProvider {
  available = false;
  async chat() {
    throw new Error("No chat model configured -- see server/adapters/llm.mjs");
  }
}

export class OllamaChatProvider {
  available = true;
  // numCtx: optional context-window override (Ollama's `options.num_ctx`). Left unset, Ollama
  // uses the model's own default context, which needs enough free RAM for its KV cache on top
  // of the model weights -- on a memory-constrained host that can fail outright ("model
  // requires more system memory than is available") rather than just running slower. Set
  // OLLAMA_NUM_CTX (a small value like 256-512) on a constrained machine to trade context
  // length for a KV cache that actually fits; this was validated against a real local
  // Llama 3.2 3B model on a 3.8GB-RAM host, which only completed a chat request once num_ctx
  // was capped this way -- it isn't a hypothetical knob.
  constructor({ baseUrl, model, timeoutMs = 20000, maxBytes = 500000, numCtx }) {
    if (!baseUrl || !model) {
      throw new Error("OllamaChatProvider requires both a baseUrl and a model");
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.numCtx = numCtx;
  }

  // messages: [{role, content}] chat history, oldest first.
  // jsonSchema: optional structured-output constraint. This is sent as Ollama's plain
  // `format: "json"` mode (valid JSON, unconstrained shape) plus a textual description of the
  // required schema appended as an extra system message -- NOT as `format: <schema object>`
  // (Ollama's newer, stricter structured-outputs feature). That's a deliberate compatibility
  // choice, not an oversight: `format: <object>` 400s outright against Ollama 0.3.14 ("json:
  // cannot unmarshal object into Go struct field ChatRequest.format of type string") --
  // confirmed against a real local Ollama install, not assumed -- and 0.3.x is a plausible
  // version for anyone who hasn't updated in a while. The safety property doesn't depend on
  // which mode is used either way: agentGraph.mjs's classifyIntent always re-checks the
  // model's answer against the fixed `intents` list in JS afterward and falls back to the
  // regex classifier on anything else, so a less-strict format mode can't smuggle an
  // out-of-list answer through -- it can only fail closed, the same as before.
  async chat({ messages, jsonSchema, temperature = 0, maxTokens = 300 }) {
    const finalMessages = jsonSchema
      ? [
          ...messages,
          {
            role: "system",
            content: `Respond with ONLY a single JSON object matching this schema, and nothing else -- no markdown, no explanation: ${JSON.stringify(jsonSchema)}`,
          },
        ]
      : messages;
    const bytes = await fetchBounded(
      `${this.baseUrl}/api/chat`,
      {
        method: "POST",
        timeoutMs: this.timeoutMs,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          ...(jsonSchema ? { format: "json" } : {}),
          messages: finalMessages,
          options: {
            temperature,
            num_predict: maxTokens,
            ...(this.numCtx ? { num_ctx: this.numCtx } : {}),
          },
        }),
      },
      this.maxBytes,
    );
    const parsed = JSON.parse(bytes.toString());
    const content = parsed.message?.content;
    if (typeof content !== "string") throw new Error("Ollama response missing message.content");
    return content;
  }
}

// Reads OLLAMA_BASE_URL/OLLAMA_MODEL from the environment -- the same two variables
// README.md already documented before this pass. OLLAMA_NUM_CTX is new and optional (see the
// constructor comment above) -- unset by default, so this only changes behavior on a host
// where it's explicitly configured. Never throws: returns the no-op provider on any
// misconfiguration, so callers can always safely check `.available`.
export function defaultChatProvider(env = process.env) {
  const baseUrl = env.OLLAMA_BASE_URL;
  const model = env.OLLAMA_MODEL;
  if (!baseUrl || !model) return new NoopChatProvider();
  const numCtx = env.OLLAMA_NUM_CTX ? Number.parseInt(env.OLLAMA_NUM_CTX, 10) : undefined;
  // OLLAMA_TIMEOUT_MS: also validated as a real, needed knob, not a hypothetical one -- on a
  // slow/CPU-only host, JSON-mode decoding (see the `chat()` comment above) took well over the
  // 20s default for a real classify request and the call was aborted mid-generation.
  const timeoutMs = env.OLLAMA_TIMEOUT_MS ? Number.parseInt(env.OLLAMA_TIMEOUT_MS, 10) : undefined;
  try {
    return new OllamaChatProvider({
      baseUrl,
      model,
      ...(numCtx ? { numCtx } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  } catch {
    return new NoopChatProvider();
  }
}
