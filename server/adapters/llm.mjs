import { fetchBounded } from "./providers.mjs";

export class NoopChatProvider {
  available = false;
  async chat() {
    throw new Error("No chat model configured -- see server/adapters/llm.mjs");
  }
}

export class OllamaChatProvider {
  available = true;
  // Local inference defaults: deterministic output and an 8K context.
  constructor({ baseUrl, model, timeoutMs = 180000, maxBytes = 500000, numCtx = 8192, legacyJson = false }) {
    if (!baseUrl || !model) {
      throw new Error("OllamaChatProvider requires both a baseUrl and a model");
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.numCtx = numCtx;
    this.legacyJson = legacyJson;
  }

  // Send the actual JSON schema. legacyJson is an explicit compatibility opt-in.
  async chat({ messages, jsonSchema, temperature = 0, maxTokens = 300, signal }) {
    // Llama templates consume a single .System value. Preserve every trusted
    // instruction in one leading system message rather than appending another.
    const system=messages.filter(m=>m.role==='system').map(m=>m.content);
    if(jsonSchema)system.push('Respond only with a JSON object matching this schema: '+JSON.stringify(jsonSchema));
    const finalMessages=[...(system.length?[{role:'system',content:system.join('\n\n')}]:[]),...messages.filter(m=>m.role!=='system')];
    const bytes = await fetchBounded(
      `${this.baseUrl}/api/chat`,
      {
        method: "POST",
        timeoutMs: this.timeoutMs,
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          ...(jsonSchema ? { format: this.legacyJson ? "json" : jsonSchema } : {}),
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
    this.lastInference = { model: parsed.model, totalDurationNs: parsed.total_duration, loadDurationNs: parsed.load_duration, promptEvalDurationNs: parsed.prompt_eval_duration, generationDurationNs: parsed.eval_duration, cachedPromptTokens: parsed.prompt_eval_cached_count ?? 0, promptTokens: parsed.prompt_eval_count, outputTokens: parsed.eval_count, numCtx: this.numCtx };
    const content = parsed.message?.content;
    if (typeof content !== "string") throw new Error("Ollama response missing message.content");
    return content;
  }
}

// Local-only configured provider; unconfigured deployments identify fallback explicitly.
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
