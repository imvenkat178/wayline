// A LangSmith tracing seam for the LangGraph agent (server/domain/agentGraph.mjs). LangSmith is
// a hosted debugging/tracing service for LLM chains, built by the LangChain team; using it for
// real requires the user's own LangSmith account and API key, which this environment cannot
// provision -- same category as email.mjs's provider account or a real payment processor in
// adapters/payments.mjs.
//
// Rather than silently doing nothing, or crashing when unconfigured, this defines one place
// that decides whether tracing is on, and wraps a function with LangSmith's own `traceable`
// helper only when it genuinely is. When it's off (the default), `traced()` returns the
// original function completely unchanged: no network calls, no added latency, no behavior
// difference -- so tests, CI, and normal operation never depend on LangSmith being configured
// or reachable, and this environment's blocked network to most external hosts (see README.md's
// "Known gaps" for the GTFS/Chromium/Ollama-registry precedents) can never break a plain run.
import { traceable } from "langsmith/traceable";

export function tracingEnabled(env = process.env) {
  return Boolean(env.LANGSMITH_TRACING === "true" && env.LANGSMITH_API_KEY);
}

// name: a label shown in the LangSmith UI for this step (e.g. "classifyIntent", "composeReply").
export function traced(name, fn, env = process.env) {
  if (!tracingEnabled(env)) return fn;
  return traceable(fn, { name });
}
