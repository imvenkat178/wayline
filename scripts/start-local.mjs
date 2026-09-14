import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function supervise(command, args, { label, cwd, maxRestarts = 3, windowMs = 600000, delayMs = 1000, onEvent = console.log } = {}) {
  let child, stopping = false, timer;
  const failures = [];
  const start = () => {
    if (stopping) return;
    onEvent(`${label}: starting`);
    child = spawn(command, args, { cwd, env: process.env, windowsHide: true, stdio: "inherit" });
    let ended = false;
    const end = reason => {
      if (ended || stopping) return;
      ended = true;
      const now = Date.now();
      while (failures[0] < now - windowMs) failures.shift();
      failures.push(now);
      if (failures.length > maxRestarts) {
        onEvent(`${label}: stopped after ${maxRestarts} restarts. Check the log and restart npm run pilot after correcting the error.`);
        return;
      }
      const wait = Math.min(30000, delayMs * 2 ** (failures.length - 1));
      onEvent(`${label}: ${reason}; retrying in ${wait}ms`);
      timer = setTimeout(start, wait);
    };
    child.once("error", error => end(error.code ?? "launch failed"));
    child.once("exit", (code, signal) => end(`exited ${signal ?? code}`));
  };
  start();
  return { stop() { stopping = true; clearTimeout(timer); if (child && child.exitCode === null) child.kill(); } };
}
async function listening(port) {
  return new Promise(resolve => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1500, () => finish(false));
    socket.once("connect", () => finish(true)); socket.once("error", () => finish(false));
  });
}
async function main() {
  const cwd = fileURLToPath(new URL("../", import.meta.url)), port = Number(process.env.PORT ?? 4174);
  if (await listening(port)) throw new Error(`Port ${port} is already occupied. Stop that Wayline instance before starting the local supervisor.`);
  const services = [];
  const configPath = resolve(cwd, ".runtime/transit-runtime.json");
  const otpUrl = process.env.OTP_GRAPHQL_URL;
  if (otpUrl && ["127.0.0.1", "localhost"].includes(new URL(otpUrl).hostname)) {
    const otpPort = Number(new URL(otpUrl).port || 80);
    if (await listening(otpPort)) console.log(`Routing: using existing process on port ${otpPort}; it remains externally managed.`);
    else if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      services.push(supervise(config.java, ["-Xmx6G", "-jar", config.jar, "--load", "--serve", "--port", String(otpPort), "--bindAddress", "127.0.0.1", config.region], { label: "Boston routing", cwd }));
    } else console.error("Routing runtime missing. Run npm run transit:setup, then npm run transit:build.");
  }
  services.push(supervise(process.execPath, ["server/server.mjs"], { label: "Wayline", cwd }));
  const stop = () => { services.forEach(s => s.stop()); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  console.log(`Local pilot: http://127.0.0.1:${port}. Routing may need a minute to load its graph. No OS startup task has been installed.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
