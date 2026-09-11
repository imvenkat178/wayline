import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// R08: scripts/build-sw.mjs is a postbuild step (see package.json's "build" script) that turns
// public/sw.js's template (CACHE_VERSION="wayline-shell-v1", BUILD_ASSETS=[]) into the real
// worker shipped in standalone/, precaching this build's actual entry JS/CSS under a
// content-derived cache name. It reads/writes real files under process.cwd()/standalone, so this
// exercises it as a real subprocess against a throwaway directory rather than importing it (an
// import would run its top-level existsSync/process.exit(1) against whatever process.cwd()
// happens to be for the test run, which is not something a unit test should depend on).

const scriptPath = fileURLToPath(new URL("../scripts/build-sw.mjs", import.meta.url));

const SW_TEMPLATE = `const CACHE_VERSION = "wayline-shell-v1";
const BUILD_ASSETS = [];
`;

// Deliberately NOT a default parameter (`sw = SW_TEMPLATE` in the signature) -- a destructured
// default applies on an explicitly passed `undefined` too, which would make the "files missing"
// fixture below silently write the template anyway. Defaulting is done in the body instead, so
// only an actually-omitted `sw` key falls back to SW_TEMPLATE.
function makeFixture(opts = {}) {
  const html = opts.html;
  const sw = "sw" in opts ? opts.sw : SW_TEMPLATE;
  const dir = mkdtempSync(join(tmpdir(), "build-sw-test-"));
  const outDir = join(dir, "standalone");
  mkdirSync(outDir, {recursive:true});
  if (html !== undefined) writeFileSync(join(outDir, "index.html"), html);
  if (sw !== undefined) writeFileSync(join(outDir, "sw.js"), sw);
  return { dir, outDir };
}

function runBuildSw(cwd) {
  return execFileSync(process.execPath, [scriptPath], { cwd, encoding: "utf8" });
}

test("build-sw.mjs rewrites CACHE_VERSION and BUILD_ASSETS from the real index.html asset references", () => {
  const html = `<html><head>
    <script type="module" src="/assets/index-abc123.js"></script>
    <link rel="stylesheet" href="/assets/index-def456.css" />
  </head><body></body></html>`;
  const { dir, outDir } = makeFixture({ html });
  try {
    runBuildSw(dir);
    const sw = readFileSync(join(outDir, "sw.js"), "utf8");
    assert.match(sw, /const CACHE_VERSION = "wayline-shell-[0-9a-f]{16}";/);
    assert.doesNotMatch(sw, /wayline-shell-v1/);
    assert.match(
      sw,
      /const BUILD_ASSETS = \["\/assets\/index-abc123\.js","\/assets\/index-def456\.css"\];/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build-sw.mjs's CACHE_VERSION is a deterministic hash of the sorted unique asset URL set", () => {
  const html = `<script src="/assets/a.js"></script><link href="/assets/b.css">`;
  const { dir, outDir } = makeFixture({ html });
  try {
    runBuildSw(dir);
    const sw = readFileSync(join(outDir, "sw.js"), "utf8");
    const expectedFingerprint = createHash("sha256")
      .update(["/assets/a.js", "/assets/b.css"].sort().join("\n"))
      .digest("hex")
      .slice(0, 16);
    assert.match(sw, new RegExp(`wayline-shell-${expectedFingerprint}"`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build-sw.mjs dedupes repeated asset references (e.g. modulepreload + the entry script for the same URL)", () => {
  const html = `<script src="/assets/x.js"></script><link rel="modulepreload" href="/assets/x.js">`;
  const { dir, outDir } = makeFixture({ html });
  try {
    runBuildSw(dir);
    const sw = readFileSync(join(outDir, "sw.js"), "utf8");
    assert.match(sw, /const BUILD_ASSETS = \["\/assets\/x\.js"\];/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build-sw.mjs exits non-zero and leaves sw.js untouched when index.html/sw.js are missing", () => {
  const { dir, outDir } = makeFixture({ html: undefined, sw: undefined });
  try {
    assert.throws(() => runBuildSw(dir));
    // Nothing was written -- the fixture directory has neither file, still true after the attempt.
    assert.throws(() => readFileSync(join(outDir, "sw.js"), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build-sw.mjs exits non-zero rather than shipping a worker whose precache covers nothing, when index.html has no /assets/ references", () => {
  const { dir } = makeFixture({ html: "<html><body>no assets here</body></html>" });
  try {
    assert.throws(() => runBuildSw(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build-sw.mjs exits non-zero rather than shipping an unpatched worker, when sw.js's template markers are missing", () => {
  const html = `<script src="/assets/a.js"></script>`;
  const { dir } = makeFixture({ html, sw: "// no markers here\n" });
  try {
    assert.throws(() => runBuildSw(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
