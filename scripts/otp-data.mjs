// Prepares an OpenTripPlanner data directory for the container stack (docker-compose.yml,
// ROADMAP G2.2): downloads MBTA GTFS and Massachusetts OpenStreetMap data and copies the validated
// OTP configuration from infra/otp. Existing downloads are reused unless --refresh is passed.
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = resolve(process.env.OTP_DATA_DIR ?? ".runtime/boston");
const configDir = resolve(process.env.OTP_CONFIG_DIR ?? fileURLToPath(new URL("../infra/otp/", import.meta.url)));
const refresh = process.argv.includes("--refresh");
// OTP detects inputs by file name: *.gtfs.zip for transit schedules and *.osm.pbf for streets.
const sources = [
  ["https://cdn.mbta.com/MBTA_GTFS.zip", "mbta.gtfs.zip"],
  ["https://download.geofabrik.de/north-america/us/massachusetts-latest.osm.pbf", "massachusetts.osm.pbf"],
];

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function download(url, name) {
  const path = join(dataDir, name);
  if (!refresh) {
    try {
      const manifest = JSON.parse(await readFile(`${path}.download.json`, "utf8"));
      if ((await stat(path)).size === manifest.size) {
        console.log(`Ready: ${name} (downloaded ${manifest.downloadedAt})`);
        return;
      }
    } catch {
      // A missing or incomplete download is fetched again.
    }
  }
  console.log(`Downloading: ${url}`);
  const response = await fetch(url, {
    headers: { "User-Agent": "Wayline-container-setup" },
    signal: AbortSignal.timeout(900000),
  });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
  await pipeline(response.body, createWriteStream(`${path}.part`));
  await rename(`${path}.part`, path);
  const manifest = { url, sha256: await sha256(path), size: (await stat(path)).size, downloadedAt: new Date().toISOString() };
  await writeFile(`${path}.download.json`, JSON.stringify(manifest, null, 2));
  console.log(`Downloaded: ${name}`);
}

await mkdir(dataDir, { recursive: true });
for (const [url, name] of sources) await download(url, name);
for (const name of ["build-config.json", "router-config.json"]) await copyFile(join(configDir, name), join(dataDir, name));
console.log(`OpenTripPlanner data is ready in ${dataDir}. Build the graph next.`);
