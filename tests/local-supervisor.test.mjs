import test from "node:test";
import assert from "node:assert/strict";
import { supervise } from "../scripts/start-local.mjs";

test("local supervisor restarts crashed processes only up to its budget", async () => {
  const events = [];
  await new Promise((resolve, reject) => {
    // Three real Node process starts can exceed 10s during CPU-only model inference.
    // The assertions below still require exactly the configured restart budget.
    const timeout = setTimeout(() => { runner.stop(); reject(new Error("Supervisor did not stop retrying. Events: " + events.join("; "))); }, 30000);
    const runner = supervise(process.execPath, ["-e", "process.exit(7)"], { label: "fixture", maxRestarts: 2, delayMs: 10,
      onEvent: event => { events.push(event); if (event.includes("stopped after")) { clearTimeout(timeout); runner.stop(); resolve(); } } });
  });
  assert.equal(events.filter(e => e === "fixture: starting").length, 3);
  assert.equal(events.filter(e => e.includes("retrying")).length, 2);
});
