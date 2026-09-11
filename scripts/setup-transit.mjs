import { mkdir, readFile, writeFile, rename, stat, readdir } from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
const root = resolve(".runtime"),
  region = join(root, "boston");
await mkdir(region, { recursive: true });
async function hash(path) {
  const h = createHash("sha256");
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest("hex");
}
async function download(url, path, expected) {
  try {
    const meta = JSON.parse(await readFile(path + ".download.json", "utf8"));
    if (
      !(process.argv.includes("--refresh") && !expected && path !== join(root, "otp.jar")) &&
      (await stat(path)).size === meta.size &&
      (await hash(path)) === (expected || meta.sha256)
    ) {
      console.log("Ready:", path);
      return;
    }
  } catch {
    /* Missing or invalid local data is downloaded again. */
  }
  console.log("Downloading:", url);
  const r = await fetch(url, {
    headers: { "User-Agent": "Wayline-local-pilot" },
    signal: AbortSignal.timeout(600000),
  });
  if (!r.ok) throw Error("Download HTTP " + r.status);
  await pipeline(r.body, createWriteStream(path + ".part"));
  const digest = await hash(path + ".part");
  if (expected && expected !== digest) throw Error("Checksum mismatch: " + path);
  await rename(path + ".part", path);
  await writeFile(
    path + ".download.json",
    JSON.stringify({
      url,
      sha256: digest,
      size: (await stat(path)).size,
      downloadedAt: new Date().toISOString(),
    }),
  );
  console.log("Downloaded:", path);
}
await download(
  "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/OpenJDK25U-jre_x64_windows_hotspot_25.0.4.1_1.zip",
  join(root, "java.zip"),
  "4c95451cea98556def2c54f7782933f52a26d4a36bd85e1d59f0364464828b07",
);
await download(
  "https://github.com/opentripplanner/OpenTripPlanner/releases/download/v2.10.0/otp-shaded-2.10.0.jar",
  join(root, "otp.jar"),
);
await download("https://cdn.mbta.com/MBTA_GTFS.zip", join(region, "mbta.gtfs.zip"));
await download(
  "https://download.geofabrik.de/north-america/us/massachusetts-latest.osm.pbf",
  join(region, "massachusetts.osm.pbf"),
);
const javaDir = join(root, "java");
await mkdir(javaDir, { recursive: true });
if (!(await readdir(javaDir)).length) {
  await new Promise((ok, bad) => {
    const p = spawn("tar.exe", ["-xf", join(root, "java.zip"), "-C", javaDir], {
      stdio: "inherit",
      windowsHide: true,
    });
    p.on("exit", (c) => (c ? bad(Error("Java extraction failed")) : ok()));
    p.on("error", bad);
  });
}
const dir = (await readdir(javaDir)).find((x) => x.startsWith("jdk"));
const java = join(javaDir, dir, "bin", "java.exe");
await writeFile(
  join(root, "transit-runtime.json"),
  JSON.stringify({ java, jar: join(root, "otp.jar"), region }, null, 2),
);
await writeFile(
  join(region, "build-config.json"),
  JSON.stringify(
    { transitServiceStart: "-P1D", transitServiceEnd: "P2M", osmCacheDataInMem: false },
    null,
    2,
  ),
);
await writeFile(
  join(region, "router-config.json"),
  JSON.stringify(
    {
      routingDefaults: { walkReluctance: 2 },
      updaters: [
        {
          type: "stop-time-updater",
          frequency: "30s",
          url: "https://cdn.mbta.com/realtime/TripUpdates.pb",
          feedId: "mbta-ma-us",
        },
      ],
    },
    null,
    2,
  ),
);
console.log("Boston routing assets ready. Run npm run transit:build, then npm run transit:start.");
