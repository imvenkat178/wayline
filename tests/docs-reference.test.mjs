// The technical references (docs/README.md) must name every API path the server handles and every
// environment variable the code reads, so a new route or setting cannot ship undocumented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const sources = (dirs) =>
  dirs.flatMap((dir) =>
    readdirSync(join(root, dir), { recursive: true })
      .filter((file) => /\.(mjs|js|ts)$/.test(file))
      .map((file) => read(join(dir, file))),
  );

// Ollama's own HTTP API, called by server/adapters/llm.mjs; not a Wayline route.
const NOT_WAYLINE_ROUTES = new Set(["/api/chat"]);

test("docs/reference/API.md names every API path the server handles", () => {
  const reference = read("docs/reference/API.md");
  const paths = new Set(
    sources(["server"]).flatMap((text) =>
      [...text.matchAll(/["'`](\/api\/[\w/:.-]*)/g)].map((m) => m[1].replace(/\/+$/, "")),
    ),
  );
  const missing = [...paths].filter((p) => !NOT_WAYLINE_ROUTES.has(p) && !reference.includes(p)).sort();
  assert.ok(paths.size > 50, `expected to find the server's API paths, found ${paths.size}`);
  assert.deepEqual(missing, [], `Add these paths to docs/reference/API.md: ${missing.join(", ")}`);
});

test("docs/reference/CONFIGURATION.md names every environment variable the code reads", () => {
  const reference = read("docs/reference/CONFIGURATION.md");
  const names = new Set(
    sources(["server", "shared", "scripts"]).flatMap((text) =>
      [...text.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]),
    ),
  );
  const missing = [...names].filter((name) => !reference.includes("`" + name + "`")).sort();
  assert.ok(names.size > 40, `expected to find the code's environment variables, found ${names.size}`);
  assert.deepEqual(missing, [], `Add these variables to docs/reference/CONFIGURATION.md: ${missing.join(", ")}`);
});
