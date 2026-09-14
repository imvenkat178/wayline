import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

export async function loadMapLibre() {
  const lib = await import("maplibre-gl");
  // MapLibre 6 expects a sibling worker file. Vite renames the main bundle,
  // so emit the worker (including its shared imports) as an explicit asset.
  lib.setWorkerUrl(workerUrl);
  return lib;
}
