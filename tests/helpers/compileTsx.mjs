// Phase 9 (accessibility): Node's --experimental-strip-types flag only strips TypeScript type
// annotations, not JSX syntax -- it can't import a .tsx file directly (confirmed: "Unknown file
// extension" error trying to import src/components/ui.tsx as-is). This compiles a .tsx source
// file to plain ESM with esbuild (a devDependency added for exactly this purpose -- the project
// doesn't otherwise need a bundler for its Node test suite) and writes the result under the
// project root, inside node_modules' resolution reach, so `import { useState } from "react"`
// inside the compiled output resolves the same way the app's own build does, and imports the
// real component code the app ships rather than a hand-copied reimplementation of it.
import { transform } from "esbuild";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const CACHE_DIR = join(import.meta.dirname, "..", "..", ".tsx-test-cache");

export async function importTsx(absolutePath) {
  const source = readFileSync(absolutePath, "utf-8");
  const { code } = await transform(source, {
    loader: "tsx",
    jsx: "automatic",
    jsxImportSource: "react",
    format: "esm",
    sourcefile: absolutePath,
  });
  mkdirSync(CACHE_DIR, { recursive: true });
  const outPath = join(CACHE_DIR, `${createHash("sha256").update(absolutePath).digest("hex")}.mjs`);
  writeFileSync(outPath, code);
  // Cache-busting query so re-running after an edit to the source doesn't hit Node's ESM module
  // cache for the same file path.
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`);
}
