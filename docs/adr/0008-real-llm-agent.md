# 8. A LangGraph-orchestrated agent, with a real (but disabled-by-default) local model

Status: Accepted

## Context

Before this pass, `server/domain/agent.mjs`'s Agent feature (roadmap feature 46) had two parts:
a regex/keyword classifier (`parseRequest`) that always ran, and an inline, optional call to a
locally configured Ollama model (`OLLAMA_BASE_URL`/`OLLAMA_MODEL`, already documented in
README.md) that -- when configured -- only ever classified intent into one of a fixed list.
Every actual reply was still a hardcoded template string. There were also zero dedicated tests
for `agent.mjs`, despite it backing a live endpoint (`POST /api/agent`).

The user asked, in this session, for the app to actually use a real LLM, tested against a real
downloaded model (they specifically asked for an 8B Ollama model), and for LangGraph and
LangSmith to be used for orchestration and debugging.

Two things were checked directly rather than assumed:

- **Network**: this environment's egress proxy returns `403` for `registry.ollama.ai` (Ollama's
  own model-pull registry) and for `huggingface.co`/`cdn-lfs.huggingface.co` (the other realistic
  source of GGUF model weights) -- the same allowlist behavior already documented for MBTA's
  GTFS feed and the Playwright/Chromium download. `github.com`'s release-asset CDN
  (`release-assets.githubusercontent.com`) is reachable, so the Ollama _binary_ itself could be
  downloaded and run -- confirmed by actually doing it (`ollama serve` came up and reported a
  working CPU inference backend) -- but that's a dead end without any reachable source of model
  weights.
- **Hardware**: the machine this environment's device-bridge shell runs on has 4GB total RAM,
  no GPU, and no swap. An 8B model needs roughly 5GB of RAM for weights alone at a light
  quantization, before any KV cache -- it will not fit, regardless of network access.

Both facts were surfaced to the user directly (not silently substituted). The user chose to
download a smaller (3B) GGUF model themselves, outside this environment's blocked network path,
and place it in the repo's (gitignored) `models/` folder.

## Decision

Build the real thing this environment can build and test, and make the part that needs the
user's own action a clean, explicit seam rather than something faked:

- **`server/adapters/llm.mjs`**: a pluggable chat-model provider interface (`NoopChatProvider`,
  `OllamaChatProvider`), following the same pattern as `email.mjs`'s `LogEmailProvider` and
  `adapters/payments.mjs`'s sandbox provider (see ADR 3). `defaultChatProvider()` reads
  `OLLAMA_BASE_URL`/`OLLAMA_MODEL` -- unchanged variables, already documented before this pass --
  and returns the no-op provider on any misconfiguration, never throwing.
- **`server/adapters/tracing.mjs`**: a LangSmith tracing seam. `traced(name, fn)` returns `fn`
  completely unchanged -- same function reference, zero network calls -- unless both
  `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` are set, in which case it wraps `fn` with
  LangSmith's own `traceable()`. This needs the user's own LangSmith account; this environment
  cannot provision one, same category as an email provider account.
- **`server/domain/agentGraph.mjs`**: a LangGraph (`@langchain/langgraph`, open-source, no
  account needed) `StateGraph` with three nodes -- `classifyIntent`, `buildGroundedReply`,
  `composeReply` -- replacing the inline logic that used to live in `agentReply`.
  `buildGroundedReply` is deterministic and calls `agent.mjs`'s (unchanged, pulled-out)
  `groundedReply()` -- the same template logic that shipped before this pass, byte for byte.
  `classifyIntent` and `composeReply` are the only two places a model is ever consulted, and
  both degrade to the pre-existing behavior on any failure.
- **The safety property this whole design is built around: the model is never the source of a
  fact.** `classifyIntent` can only pick from the fixed `intents` list (JSON-schema-constrained,
  same as before this pass) or fall back to the regex classifier. `composeReply` is only ever
  asked to rephrase `groundedReply()`'s already-correct output for tone, under an explicit
  system-prompt instruction not to add or change any fact, and `isSuspectRewrite()` rejects any
  rewrite that drops a number the original reply carried or pads implausibly long. Whenever no
  model is configured (the default), the model errors, or its rewrite looks suspect, the
  original deterministic text ships -- unchanged from before this pass.
- **`tests/agent.test.mjs`** (21 tests) exercises all of this with an injected mock provider
  (`runAgentGraph`'s `provider` parameter) -- no live model or network dependency in the
  automated suite, including a test that a fact-dropping rewrite is rejected and a test that a
  fact-preserving rewrite is accepted and labeled `· composed`.
- **`scripts/llm-smoke-test.mjs`** is a separate, manual script -- deliberately not part of
  `npm test` -- for validating against a real local Ollama model once the user has placed a
  `.gguf` file under `models/`. It starts `ollama serve`, creates a model from the file via a
  generated `Modelfile`, and runs a few real requests through `runAgentGraph`, printing the
  resulting `mode` so it's obvious whether the real model path or the fallback path served each
  one.

## Consequences

- The Agent feature ships with the model path disabled by default (`OLLAMA_BASE_URL`/
  `OLLAMA_MODEL` unset), because this environment cannot itself supply a model -- exactly the
  "Provider required" pattern already used for `email.mjs` and `adapters/payments.mjs`. Turning
  it on requires the user's own Ollama installation and model file (or, for a hosted API, a new
  provider class in `llm.mjs` -- not built, since none was asked for).
- The 8B model originally asked for specifically does not fit this environment's own hardware
  (4GB RAM, no GPU); the user chose a 3B model instead once told why. Anyone reusing this on a
  different machine should size the model to what that machine can actually run.
- LangGraph's contribution here is structural, not decorative: `addConditionalEdges` makes "does
  a model exist and did it produce something safe to use" an explicit, independently testable
  part of the flow, and gives LangSmith tracing (when configured) a real per-node structure to
  record instead of one opaque function call.
- This only changes the Agent feature (roadmap 46). It does not touch any other feature, and it
  does not add any new hosted-LLM account or credential to the codebase -- Anthropic, OpenAI, or
  any other contracted API remains exactly as absent as it was before this pass.

## Update: validated against a real pulled model

Everything above was written when no model was reachable from this environment at all. Since
then, the user installed Ollama on their own machine and ran `ollama pull llama3.2` themselves
(a real `llama3.2`, 3B, Q4_K_M, ~2 GB) -- the path this ADR's original "Decision" section said
the user would need to take. That model was then validated for real, not left as an assumption:

- This environment's own Ollama binary (installed the way described above, from
  `release-assets.githubusercontent.com`) was pointed at the user's already-pulled model via
  Ollama's own `OLLAMA_MODELS` environment variable, rather than pulling a second copy through
  the still-blocked registry path. `ollama list` against that directory correctly showed
  `llama3.2:latest`, and `ollama serve` loaded and served it.
- That surfaced a real, previously undetected bug: `OllamaChatProvider` (in
  `server/adapters/llm.mjs`) was sending the classify step's schema as `format: <schema
object>` -- Ollama's newer structured-outputs feature. Against this real install's Ollama
  version (0.3.14), that 400s immediately: `"json: cannot unmarshal object into Go struct field
ChatRequest.format of type string"`. Fixed by sending the broadly-supported `format: "json"`
  string instead, with the schema described as plain text in an appended system message. This
  doesn't weaken the safety property this ADR is built around: `classifyIntent` in
  `agentGraph.mjs` re-checks the model's answer against the closed `intents` list in JS
  regardless of which format mode produced it, so a less-strict format mode can only fail
  closed (fall back to the regex classifier), never smuggle an out-of-list answer through. A
  test against a mocked `fetch` (`tests/agent.test.mjs`) now pins this exact request shape down
  so it can't silently regress back to the object form.
- That also surfaced a second real, previously undetected problem: the machine this Ollama
  install ran on (3.8 GB RAM, no GPU, no swap) could not load the model at its default context
  size at all -- `"model requires more system memory than is available"` -- until the context
  window was capped. `OllamaChatProvider` now accepts an optional `numCtx`, wired to a new
  `OLLAMA_NUM_CTX` environment variable; unset by default, so this changes nothing for anyone
  who doesn't need it, but it's what let a chat request complete at all on this machine.
- With that fix, a real classify-shaped HTTP request through this exact code path returned a
  correct, genuinely model-generated answer (`{"intent":"cost"}` for a cost question), and a
  real compose-shaped request independently returned a real reworded version of a grounded
  reply (labeled `· composed` in the response) -- both confirmed directly, not assumed from the
  fix alone.
- What did not fit in one sitting was running `scripts/llm-smoke-test.mjs`'s full three-case
  sequence back-to-back on that same machine within a single tool invocation here: measured
  prompt-processing throughput on it was on the order of half a second to a second and a half
  per token (evaluating a 27-token prompt alone took ~39 seconds at one point) -- a CPU/
  scheduling limit of that one sandboxed environment, not of the code or of Ollama. That's also
  why `OllamaChatProvider` now accepts an optional `timeoutMs` override via a new
  `OLLAMA_TIMEOUT_MS` environment variable: the previous fixed 20-second timeout is realistic
  for ordinary hardware but was measured, directly, to be too short here. On typical
  unconstrained hardware (most normal desktops, including whatever the user pulled the model on
  the normal way), none of this slowness is expected, and the full three-case script should
  complete in well under a minute.
- `scripts/llm-smoke-test.mjs` was extended to match how this was actually validated: it now
  accepts `MODEL_NAME` (use a model already pulled the normal way, skipping the raw-`.gguf`-
  file-plus-generated-`Modelfile` path this ADR originally described as the only option) and
  `OLLAMA_MODELS` (point at an existing Ollama install's models directory instead of pulling a
  second copy). The original raw-file path still works and is documented as the fallback for
  someone who genuinely only has a `.gguf` file and no Ollama-managed pull.

None of this changes the shipped default: `OLLAMA_BASE_URL`/`OLLAMA_MODEL` are still unset out
of the box, and the model is still never the source of a fact. What changed is that the model
path is no longer an untested assumption -- it was pointed at a real model the user actually
pulled, produced real output through the real HTTP contract this code uses, and the two bugs
that showed up in the process (an incompatible format mode, an unfittable default context) are
now fixed and pinned down by tests, not just described as hypothetical risks.
