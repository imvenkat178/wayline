// Shared agent memory (AGENTS.md): ROADMAP.md and HANDOFF.md must stay valid so every person and
// agent can rely on them. The agent memory kit ships these checks as pytest files; this repository
// runs node --test, so the same validators run here instead. The Python scripts stay unmodified.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const python = ["python3", "python"].find(
  (command) => spawnSync(command, ["--version"], { encoding: "utf8" }).status === 0,
);
const skip = python ? false : "Python 3.8 or newer is not on PATH";

function run(script, args = []) {
  return spawnSync(python, [`scripts/${script}`, ...args], { cwd: root, encoding: "utf8" });
}

test("ROADMAP.md passes the roadmap validator", { skip }, () => {
  const result = run("roadmap.py", ["check"]);
  assert.equal(result.status, 0, `ROADMAP.md failed validation:\n${result.stdout}${result.stderr}`);
});

test("HANDOFF.md is well formed and only cites open, existing roadmap IDs", { skip }, () => {
  const result = run("check_handoff.py");
  assert.equal(result.status, 0, `HANDOFF.md failed validation:\n${result.stdout}${result.stderr}`);
});

test("agent entry points reference the shared memory", () => {
  assert.match(readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8"), /HANDOFF\.md/);
  assert.match(readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8"), /@AGENTS\.md/);
});
