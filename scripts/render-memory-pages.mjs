// Regenerates the two browsable memory pages from their source files (see AGENTS.md):
//   docs/roadmap/index.html          <- ROADMAP.md, through `scripts/roadmap.py json`
//   docs/agent-memory-kit/index.html <- docs/agent-memory-kit/README.md
// Each page carries its data between /*NAME:start*/ and /*NAME:end*/ markers, so the page itself
// is the template. Edit ROADMAP.md or the kit README, never the generated data.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = (command, args) => spawnSync(command, args, { cwd: root, encoding: "utf8" });
const python = ["python3", "python"].find((command) => run(command, ["--version"]).status === 0);
if (!python) throw new Error("Python 3.8 or newer must be on PATH to export ROADMAP.md.");

// JSON is embedded inside <script>, so "<" is escaped to keep "</script>" in any text harmless.
const embed = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

function inject(file, name, value) {
  const path = `${root}/${file}`;
  const text = readFileSync(path, "utf8");
  const marker = new RegExp(`/\\*${name}:start\\*/[\\s\\S]*?/\\*${name}:end\\*/`);
  if (!marker.test(text)) throw new Error(`${file} has no /*${name}:start*/ ... /*${name}:end*/ markers.`);
  writeFileSync(path, text.replace(marker, () => `/*${name}:start*/${value}/*${name}:end*/`));
}

const exported = run(python, ["scripts/roadmap.py", "json"]);
if (exported.status !== 0) throw new Error(`roadmap.py json failed:\n${exported.stderr}`);
const head = run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
const edited = run("git", ["status", "--porcelain", "--", "ROADMAP.md"]).stdout.trim() !== "";
// Local calendar date, matching the dates agents write in HANDOFF.md and ROADMAP.md (UTC can differ).
const now = new Date();
const generated = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0")).join("-");

inject("docs/roadmap/index.html", "DATA", embed(JSON.parse(exported.stdout)));
inject(
  "docs/roadmap/index.html",
  "META",
  embed({ generated, source: `ROADMAP.md at ${head}${edited ? " with uncommitted edits" : ""}` }),
);
inject("docs/agent-memory-kit/index.html", "KIT", embed(readFileSync(`${root}/docs/agent-memory-kit/README.md`, "utf8")));
console.log(`memory pages: regenerated docs/roadmap/index.html and docs/agent-memory-kit/index.html (${generated})`);
