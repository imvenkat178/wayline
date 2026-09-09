#!/usr/bin/env node
// Manual smoke test for the real local-model path (server/adapters/llm.mjs's
// OllamaChatProvider, orchestrated by server/domain/agentGraph.mjs). This is deliberately NOT
// part of `npm test`: it needs an actual Ollama binary and an actual model on disk, neither of
// which this environment can fetch on its own (see docs/adr/0008-real-llm-agent.md for why --
// registry.ollama.ai and huggingface.co are both blocked by this environment's network egress
// allowlist). Run it yourself, locally, once you have both:
//
//   1. Ollama installed (https://ollama.com, or the binary release from
//      https://github.com/ollama/ollama/releases if ollama.com itself is unreachable for you).
//   2. A model available to that Ollama install, either of:
//      a. Pulled the normal way (`ollama pull llama3.2`) -- this is the common case, and the
//         one this script was actually validated against: a real `llama3.2` (3B, Q4_K_M, ~2GB)
//         pulled with `ollama pull llama3.2` and served locally. Set MODEL_NAME=llama3.2 (or
//         whatever you pulled) and this script uses it directly, no Modelfile step needed.
//      b. A raw .gguf file with no Ollama install-time pull at all (e.g. downloaded by hand
//         from Hugging Face) -- drop it under models/ in this repo (gitignored -- see
//         .gitignore) or point MODEL_FILE at it, and this script builds a throwaway Ollama
//         model from it via a generated Modelfile.
//
//   A 3B-class model was validated here, not the 8B this project was originally asked to use,
//   because 8B needs roughly 5GB of RAM for weights alone -- it will not run on a machine with
//   4GB or less. On a genuinely tight machine (this one had 3.8GB total, no swap), even a 3B
//   model's defalt context window can be too much on top of the weights -- Ollama fails with
//   "model requires more system memory than is available" rather than just running slower. Set
//   OLLAMA_NUM_CTX (e.g. 256) to cap the KV cache and trade context length for headroom: see
//   the comment on OllamaChatProvider in server/adapters/llm.mjs.
//
// Usage:  node scripts/llm-smoke-test.mjs
// Optional env:
//   OLLAMA_BIN     path to the ollama binary (default "ollama" on PATH)
//   OLLAMA_PORT    default 11434
//   OLLAMA_MODELS  a custom Ollama models directory to serve from (Ollama's own OLLAMA_MODELS
//                  env var) -- e.g. point this at another Ollama install's models/ folder
//                  instead of pulling a duplicate copy.
//   MODEL_NAME     name of a model already available to that Ollama install/models dir (skips
//                  the Modelfile step entirely). Takes priority over MODEL_FILE.
//   MODEL_FILE     path to a raw .gguf file (default: the first *.gguf under models/) --
//                  used only when MODEL_NAME isn't set.
//   OLLAMA_NUM_CTX context-window cap passed straight to server/adapters/llm.mjs's provider.
import { spawn } from "node:child_process";
import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const ollamaBin = process.env.OLLAMA_BIN ?? "ollama";
const port = process.env.OLLAMA_PORT ?? "11434";
const baseUrl = `http://127.0.0.1:${port}`;
const modelfileModelName = "wayline-local-smoke-test";

function findModelFile() {
  if (process.env.MODEL_FILE) return process.env.MODEL_FILE;
  const dir = join(root, "models");
  if (!existsSync(dir)) return null;
  const gguf = readdirSync(dir).find((f) => f.endsWith(".gguf"));
  return gguf ? join(dir, gguf) : null;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "pipe", ...opts });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve({ out, err }) : reject(new Error(err || out)),
    );
  });
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${baseUrl}/`);
      if (r.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function resolveModelName(serveEnv) {
  if (process.env.MODEL_NAME) return process.env.MODEL_NAME;

  const modelFile = findModelFile();
  if (!modelFile || !existsSync(modelFile)) {
    console.error(
      "No model configured. Either:\n" +
        "  - set MODEL_NAME=<name> to use a model already pulled/available to this Ollama install " +
        "(check with `ollama list`), or\n" +
        "  - put a raw .gguf file under models/ (e.g. models/qwen2.5-3b-instruct-q4_k_m.gguf) or set " +
        "MODEL_FILE=/path/to/model.gguf.",
    );
    process.exit(1);
  }
  console.log(`Using raw model file: ${modelFile}`);
  const modelfilePath = join(root, ".llm-smoke-test.Modelfile");
  writeFileSync(modelfilePath, `FROM ${modelFile}\n`);
  console.log(
    `Creating Ollama model "${modelfileModelName}" from the Modelfile (this can take a minute)...`,
  );
  await run(ollamaBin, ["create", modelfileModelName, "-f", modelfilePath], { env: serveEnv });
  console.log("Model created.");
  return modelfileModelName;
}

async function main() {
  const serveEnv = {
    ...process.env,
    OLLAMA_HOST: `127.0.0.1:${port}`,
    // Passing this through (rather than only reading it) lets OLLAMA_MODELS point `ollama
    // serve` at models pulled by a separate, already-configured Ollama install -- e.g. one on
    // the same machine that already ran `ollama pull llama3.2` -- without pulling a second copy.
    ...(process.env.OLLAMA_MODELS ? { OLLAMA_MODELS: process.env.OLLAMA_MODELS } : {}),
  };

  console.log("Starting `ollama serve` in the background...");
  const server = spawn(ollamaBin, ["serve"], { stdio: "ignore", env: serveEnv, detached: true });
  server.unref();

  const up = await waitForServer();
  if (!up) {
    console.error(
      `Ollama did not come up on ${baseUrl} within 15s. Is "${ollamaBin}" the right binary?`,
    );
    process.exit(1);
  }
  console.log("Ollama is up.");

  const modelName = await resolveModelName(serveEnv);

  process.env.OLLAMA_BASE_URL = baseUrl;
  process.env.OLLAMA_MODEL = modelName;
  const { runAgentGraph } = await import("../server/domain/agentGraph.mjs");
  const { sampleSearch } = await import("../server/domain/journeys.mjs");

  const journey = sampleSearch({ from: "sf", to: "oak", departure: "2026-06-01T18:00:00Z" })
    .journeys[0];

  const cases = [
    {
      label: "cost question, real journey",
      input: "how much is this trip going to cost me?",
      journey,
    },
    { label: "delay question, real journey", input: "why is my train late today?", journey },
    { label: "no journey selected", input: "what platform do I board at?", journey: null },
  ];

  console.log(`\nRunning real requests through the local model ("${modelName}"):\n`);
  for (const c of cases) {
    const started = Date.now();
    const result = await runAgentGraph({
      input: c.input,
      journey: c.journey,
      preferences: {},
      history: [],
    });
    console.log(`--- ${c.label} (${Date.now() - started}ms) ---`);
    console.log(`intent: ${result.intent}`);
    console.log(`mode:   ${result.mode}`);
    console.log(`reply:  ${result.reply}`);
    console.log();
  }

  console.log(
    'Done. If `mode` above says "Ollama classify · ..." the model actually classified the\n' +
      'request; if it says "Rules assistant · local model unavailable" something about the\n' +
      "model/server didn't work and the deterministic fallback took over instead -- check the\n" +
      "ollama serve output, or try a smaller OLLAMA_NUM_CTX if the failure mentions system memory.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
