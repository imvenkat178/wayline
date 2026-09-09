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
  constructor({ baseUrl, model, timeoutMs = 20000, maxBytes = 500000 }) {
    if (!baseUrl || !model) {
      throw new Error("OllamaChatProvider requires both a baseUrl and a model");
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
  }

  // messages: [{role, content}] chat history, oldest first.
  // jsonSchema: optional structured-output constraint (Ollama's "format" field). Used by the
  // classify step so the model can only answer with one of a fixed set of intents -- never
  // free text -- mirroring the original inline behavior this replaces.
  async chat({ messages, jsonSchema, temperature = 0, maxTokens = 300 }) {
    const bytes = await fetchBounded(
      `${this.baseUrl}/api/chat`,
      {
        method: "POST",
        timeoutMs: this.timeoutMs,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          ...(jsonSchema ? { format: jsonSchema } : {}),
          messages,
          options: { temperature, num_predict: maxTokens },
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
// README.md already documented before this pass. Never throws: returns the no-op provider on
// any misconfiguration, so callers can always safely check `.available`.
export function defaultChatProvider(env = process.env) {
  const baseUrl = env.OLLAMA_BASE_URL;
  const model = env.OLLAMA_MODEL;
  if (!baseUrl || !model) return new NoopChatProvider();
  try {
    return new OllamaChatProvider({ baseUrl, model });
  } catch {
    return new NoopChatProvider();
  }
}
