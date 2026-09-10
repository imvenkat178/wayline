#!/usr/bin/env node
// R08: run automatically after `vite build` (see package.json's "build" script) to turn
// public/sw.js's template (BUILD_ASSETS left empty, a placeholder CACHE_VERSION) into the real
// service worker that ships in standalone/ -- one whose install() precaches the actual entry
// JS/CSS this specific build emitted, under a cache name derived from this build's own content.
//
// Before this fix, install() only ever precached a handful of URLs whose content doesn't change
// between builds (index.html, the manifest, the icon) and relied on the fetch handler's
// cache-first branch to opportunistically catch the real hashed JS/CSS bundle on some LATER
// request. A fresh browser's first visit -- open once online, close every tab -- never makes
// that later request, so install() could report success while the files actually needed to boot
// the app offline were never cached at all. This script closes that gap by reading the build
// output Vite already produced and writing its real asset list straight into the worker that
// ships.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const outDir = resolve(process.cwd(), "standalone");
const indexPath = resolve(outDir, "index.html");
const swPath = resolve(outDir, "sw.js");

if (!existsSync(indexPath) || !existsSync(swPath)) {
  console.error(
    `build-sw.mjs: expected ${indexPath} and ${swPath} to exist -- run after \`vite build\`, not standalone.`,
  );
  process.exit(1);
}

const html = readFileSync(indexPath, "utf8");

// Every same-origin src="" or href="" Vite's HTML plugin wrote for this build's entry point:
// the entry script, its statically-known (modulepreload) dependencies, and its stylesheet. This
// is deliberately NOT every chunk the app can ever load -- App.tsx lazy-loads each route page
// (and the multi-megabyte maplibre-gl/barcode chunks) on demand, and precaching all of those
// unconditionally would bloat the precache with code most sessions never touch. It's exactly the
// synchronous boot path: enough to render the shell and, from there, the app's own offline
// fallback screen (src/pages/Offline.tsx, statically imported in App.tsx, not lazy).
const assetUrls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
if (assetUrls.length === 0) {
  console.error(
    "build-sw.mjs: found no /assets/ references in standalone/index.html -- aborting" +
      " rather than shipping a service worker whose precache silently covers nothing beyond the" +
      " static shell URLs.",
  );
  process.exit(1);
}
const uniqueAssetUrls = [...new Set(assetUrls)];

// Content-derived, not a manual bump: every real deploy gets a genuinely different cache name
// (since at least one hashed asset filename changes whenever the build output does), so
// activate()'s cleanup of "every cache that isn't the current CACHE_VERSION" actually discards
// the previous deploy's precache instead of silently keeping the same name build after build.
const fingerprint = createHash("sha256")
  .update([...uniqueAssetUrls].sort().join("\n"))
  .digest("hex")
  .slice(0, 16);
const cacheVersion = `wayline-shell-${fingerprint}`;

let sw = readFileSync(swPath, "utf8");
const versionPattern = /const CACHE_VERSION = "[^"]*";/;
const assetsPattern = /const BUILD_ASSETS = \[\];/;
if (!versionPattern.test(sw) || !assetsPattern.test(sw)) {
  console.error(
    "build-sw.mjs: public/sw.js's CACHE_VERSION/BUILD_ASSETS template markers were not found " +
      "verbatim in standalone/sw.js -- the template in public/sw.js was likely edited without " +
      "updating this script's patterns to match. Aborting rather than shipping an unpatched worker.",
  );
  process.exit(1);
}
sw = sw
  .replace(versionPattern, `const CACHE_VERSION = "${cacheVersion}";`)
  .replace(assetsPattern, `const BUILD_ASSETS = ${JSON.stringify(uniqueAssetUrls)};`);
writeFileSync(swPath, sw);

console.log(
  `build-sw.mjs: wrote ${swPath} -- CACHE_VERSION=${cacheVersion}, ${uniqueAssetUrls.length} precached build asset(s).`,
);
