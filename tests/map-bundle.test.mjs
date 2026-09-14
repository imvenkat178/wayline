import test from "node:test";
import assert from "node:assert/strict";
import { build } from "vite";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join, sep } from "node:path";

test("production bundling emits and references the MapLibre geometry worker", async t => {
  const root = resolve("tmp");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "map-bundle-"));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(root + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const entry = join(directory, "entry.ts");
  writeFileSync(entry, 'import { loadMapLibre } from "../../src/mapRuntime.ts"; void loadMapLibre();');
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: { outDir: join(directory, "dist"), rollupOptions: { input: entry } },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap(r => r.output);
  const worker = output.find(asset => /maplibre-gl-worker-[\w-]+\.js$/.test(asset.fileName));
  assert.ok(worker, "The geometry worker must be emitted, not guessed relative to the renamed map chunk.");
  assert.ok(worker.source.length > 10000, "Worker code must include its bundled dependencies.");
  assert.ok(output.some(asset => asset.type === "chunk" && asset.code.includes(worker.fileName)), "The runtime must reference the worker asset that was emitted.");
});
