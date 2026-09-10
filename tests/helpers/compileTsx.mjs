// Phase 9 (accessibility): Node's --experimental-strip-types flag only strips TypeScript type
// annotations, not JSX syntax -- it can't import a .tsx file directly (confirmed: "Unknown file
// extension" error trying to import src/components/ui.tsx as-is). This compiles a .tsx source
// file to plain ESM with esbuild (a devDependency added for exactly this purpose -- the project
// doesn't otherwise need a bundler for its Node test suite) and writes the result under the
// project root, inside node_modules' resolution reach, so `import { useState } from "react"`
// inside the compiled output resolves the same way the app's own build does, and imports the
// real component code the app ships rather than a hand-copied reimplementation of it.
//
// bundle: true so this also resolves and inlines the file's own local/relative imports (e.g.
// src/components/ui.tsx importing "../theme" for the theme toggle) -- esbuild walks those on
// disk the same way Vite's build does. "react" itself stays external: react-dom/server (used by
// the tests to render) and this compiled output must share the exact same react module instance
// for hooks to work, and bundling would give the output its own separate copy instead.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const CACHE_DIR = join(import.meta.dirname, "..", "..", ".tsx-test-cache");

export async function importTsx(absolutePath) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const outPath = join(CACHE_DIR, `${createHash("sha256").update(absolutePath).digest("hex")}.mjs`);
  await build({
    entryPoints: [absolutePath],
    outfile: outPath,
    bundle: true,
    write: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    jsxImportSource: "react",
    external: ["react", "react-dom", "react-dom/*", "react/*"],
  });
  // Cache-busting query so re-running after an edit to the source doesn't hit Node's ESM module
  // cache for the same file path.
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`);
}
