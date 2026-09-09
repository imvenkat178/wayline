import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ocrDir = fileURLToPath(new URL("../public/ocr/", import.meta.url));
const scannerPath = fileURLToPath(new URL("../src/components/Scanner.tsx", import.meta.url));
const scanner = readFileSync(scannerPath, "utf8");

test("public/ocr contains the worker script and every core variant Scanner.tsx can request", () => {
  // Scanner.tsx uses oem=1 (LSTM_ONLY), so getCore.js (tesseract.js's own core-selection logic)
  // will request one of the *-lstm.wasm.js variants below depending on the browser's WASM SIMD
  // support -- both must be present, or recognition silently fails for whichever capability
  // class of browser isn't covered.
  const required = [
    "worker.min.js",
    "tesseract-core-lstm.wasm",
    "tesseract-core-lstm.wasm.js",
    "tesseract-core-simd-lstm.wasm",
    "tesseract-core-simd-lstm.wasm.js",
  ];
  for (const file of required) {
    const full = ocrDir + file;
    assert.ok(existsSync(full), `missing OCR asset: public/ocr/${file}`);
    assert.ok(statSync(full).size > 0, `OCR asset is empty: public/ocr/${file}`);
  }
});

test("public/ocr includes license attribution for the bundled tesseract.js/tesseract.js-core assets", () => {
  for (const file of ["LICENSE-tesseract.js.md", "LICENSE-tesseract.js-core.md"]) {
    assert.ok(existsSync(ocrDir + file), `missing license file: public/ocr/${file}`);
  }
});

test("Scanner.tsx points at the locally bundled worker/core paths, not a remote host", () => {
  assert.match(scanner, /workerPath:\s*"\/ocr\/worker\.min\.js"/);
  assert.match(scanner, /corePath:\s*"\/ocr\/"/);
});

test("Scanner.tsx terminates a worker that finished creating after the component already unmounted (regression)", () => {
  // The original bug: createWorker() is async; if the modal closed while it was still in
  // flight, the unmount cleanup effect ran while `worker.current` was still null and could
  // terminate nothing, leaking the worker (and, once creation finished, calling setState on an
  // unmounted component). Assert the cancellation guard exists at both required points: set on
  // unmount, and checked immediately after createWorker() resolves.
  assert.match(scanner, /cancelled\.current\s*=\s*true/);
  assert.match(scanner, /if\s*\(cancelled\.current\)\s*\{\s*[\s\S]*?created\.terminate\(\)/);
});
