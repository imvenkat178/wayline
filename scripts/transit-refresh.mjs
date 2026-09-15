// Refreshes the container stack's Boston routing data (ROADMAP G2.9): downloads current MBTA GTFS
// and OpenStreetMap data, rebuilds the OpenTripPlanner graph, restarts the router and waits until
// it reports schedules that have not expired. The previous graph is kept as graph.obj.previous and
// restored if any step fails. Run it on the Docker host from cron or Windows Task Scheduler; the
// hosted scheduler waits on the hosting decision (G2.1). Routing is unavailable while OTP restarts.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const compose = (args, capture = false) =>
  execFileSync("docker", ["compose", ...args], { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
const graphShell = (script, capture = false) =>
  compose(["run", "--rm", "--no-deps", "--entrypoint", "sh", "otp-data", "-c", script], capture);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSchedules(minutes = 10) {
  const probe = `fetch("http://otp:8080/otp/gtfs/v1",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query:"{ serviceTimeRange { start end } }"})}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j.data.serviceTimeRange))).catch(()=>console.log("null"))`;
  const deadline = Date.now() + minutes * 60000;
  while (Date.now() < deadline) {
    try {
      const range = JSON.parse(compose(["exec", "-T", "app", "node", "-e", probe], true).trim());
      if (range && range.end * 1000 > Date.now()) return range;
    } catch {
      // The router is still loading its graph.
    }
    await sleep(10000);
  }
  throw new Error(`OpenTripPlanner did not report current schedules within ${minutes} minutes.`);
}

const hadGraph = graphShell(
  "if [ -f /var/opentripplanner/graph.obj ]; then cp /var/opentripplanner/graph.obj /var/opentripplanner/graph.obj.previous && echo kept; fi",
  true,
).includes("kept");
console.log(hadGraph ? "Previous graph kept as graph.obj.previous." : "No previous graph to keep.");
try {
  compose(["run", "--rm", "otp-data", "node", "otp-data.mjs", "--refresh"]);
  compose(["run", "--rm", "otp-build"]);
  compose(["restart", "otp"]);
  const range = await waitForSchedules();
  console.log(`Routing refreshed: schedules from ${new Date(range.start * 1000).toISOString()} to ${new Date(range.end * 1000).toISOString()}.`);
} catch (error) {
  console.error(`Refresh failed: ${error.message}`);
  if (hadGraph) {
    console.error("Restoring the previous graph.");
    graphShell("if [ -f /var/opentripplanner/graph.obj.previous ]; then cp /var/opentripplanner/graph.obj.previous /var/opentripplanner/graph.obj; fi");
    compose(["restart", "otp"]);
    await waitForSchedules().catch((restoreError) => console.error(`Previous graph did not come back: ${restoreError.message}`));
  }
  process.exitCode = 1;
}
