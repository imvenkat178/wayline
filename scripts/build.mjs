import { execFileSync } from "node:child_process";
// The API may run in development locally, but distributable assets must always use
// production React and include the offline service worker.
const env = { ...process.env, NODE_ENV: "production" };
for (const args of [
  ["node_modules/typescript/bin/tsc", "-b"],
  ["node_modules/vite/bin/vite.js", "build"],
  ["scripts/build-sw.mjs"],
]) {
  execFileSync(process.execPath, args, { stdio: "inherit", env, windowsHide: true });
}
