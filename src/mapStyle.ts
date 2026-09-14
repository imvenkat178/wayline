import type { RequestParameters, StyleSpecification } from "maplibre-gl";

const tileOrigin = "https://tile.openstreetmap.org/";

// OSM requires a browser referrer. Send only this application's origin for
// tile requests; keep journey paths, query strings and credentials private.
// All other requests retain the application's default no-referrer policy.
export function mapTileRequest(url: string): RequestParameters {
  return url.startsWith(tileOrigin)
    ? { url, referrerPolicy: "strict-origin", credentials: "same-origin", cache: "default" }
    : { url };
}

export function journeyMapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: [tileOrigin + "{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#e8f2f5" } },
      { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.15, "raster-opacity": 0.95 } },
    ],
  };
}
