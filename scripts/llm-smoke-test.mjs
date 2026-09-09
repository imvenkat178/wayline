#!/usr/bin/env node
// Manual smoke test for the real local-model path (server/adapters/llm.mjs's
// OllamaChatProvider, orchestrated by server/domain/agentGraph.mjs). This is deliberately NOT
// part of `npm test`: it needs an actual Ollama binary and an actual GGUF model file on disk,
// neither of which this environment can fetch on its own (see docs/adr/0008-real-llm-agent.md
// for why -- registry.ollama.ai and huggingface.co are both blocked by this environment's
// network egress allowlist). Run it yourself, locally, once you have both:
//
//   1. Ollama installed (https://ollama.com, or the binary release from
//      https://github.com/ollama/ollama/releases if ollama.com itself is unreachable for you).
//   2. A GGUF model file under models/ in this repo (gitignored -- see .gitignore). This
//      project was validated against Qwen2.5-3B-Instruct-Q4_K_M.gguf from
//      https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF -- a 3B model was chosen over
//      the 8B originally asked for because it comfortably fits machines with 4GB+ RAM and no
//      GPU; an 8B model needs roughly 5GB for weights alone and will not run acceptably on a
//      constrained machine.
//
// Usage:  node scripts/llm-smoke-test.mjs
// Optional env: OLLAMA_BIN (path to the ollama binary, default "ollama" on PATH),
//               MODEL_FILE (path to the .gguf file, default: the first *.gguf under models/),
//               OLLAMA_PORT (default 11434).
import { spawn } from "node:child_process";
import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const ollamaBin = process.env.OLLAMA_BIN ?? "ollama";
const port = process.env.OLLAMA_PORT ?? "11434";
const baseUrl = `http://127.0.0.1:${port}`;
const modelName = "wayline-local-smoke-test";

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

async function main() {
  const modelFile = findModelFile();
  if (!modelFile || !existsSync(modelFile)) {
    console.error(
      "No .gguf model file found. Put one under models/ (e.g. models/qwen2.5-3b-instruct-q4_k_m.gguf) " +
        "or set MODEL_FILE=/path/to/model.gguf, then re-run this script.",
    );
    process.exit(1);
  }
  console.log(`Using model file: ${modelFile}`);

  console.log("Starting `ollama serve` in the background...");
  const server = spawn(ollamaBin, ["serve"], {
    stdio: "ignore",
    env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${port}` },
    detached: true,
  });
  server.unref();

  const up = await waitForServer();
  if (!up) {
    console.error(
      `Ollama did not come up on ${baseUrl} within 15s. Is "${ollamaBin}" the right binary?`,
    );
    process.exit(1);
  }
  console.log("Ollama is up.");

  const modelfilePath = join(root, ".llm-smoke-test.Modelfile");
  writeFileSync(modelfilePath, `FROM ${modelFile}\n`);
  console.log(
    `Creating Ollama model "${modelName}" from the Modelfile (this can take a minute)...`,
  );
  await run(ollamaBin, ["create", modelName, "-f", modelfilePath], {
    env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${port}` },
  });
  console.log("Model created.");

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

  console.log("\nRunning real requests through the local model:\n");
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
      "ollama serve output (run `ollama serve` yourself in another terminal to see logs).",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
