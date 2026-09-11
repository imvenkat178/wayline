import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const config = JSON.parse(
  readFileSync(new URL("../.runtime/transit-runtime.json", import.meta.url), "utf8"),
);
const build = process.argv.includes("--build");
const args = [
  "-Xmx6G",
  "-jar",
  config.jar,
  ...(build
    ? ["--build", "--save"]
    : ["--load", "--serve", "--port", "8080", "--bindAddress", "127.0.0.1"]),
  config.region,
];
const p = spawn(config.java, args, { stdio: "inherit", windowsHide: true });
p.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
p.on("exit", (c) => process.exit(c ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => p.kill(signal));
