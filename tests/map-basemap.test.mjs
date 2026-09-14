import {contentSecurityPolicy} from "../server/securityPolicy.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { journeyMapStyle, mapTileRequest } from "../src/mapStyle.ts";
import { legGeometry, journeyBounds } from "../src/geometry.ts";

test("basemap requests identify the app origin, omit credentials and honor HTTP caches", () => {
  const style = journeyMapStyle();
  const source = style.sources.osm;
  const url = source.tiles[0].replace("{z}", "12").replace("{x}", "1239").replace("{y}", "1515");
  assert.equal(new URL(url).origin, "https://tile.openstreetmap.org");
  const request = new Request(url, { ...mapTileRequest(url), referrer: "http://127.0.0.1:4174/private-trip?token=private" });
  assert.equal(request.referrerPolicy, "strict-origin");
  assert.equal(request.credentials, "same-origin");
  assert.notEqual(new URL(url).origin, new URL(request.referrer).origin);
  assert.equal(request.cache, "default");
  assert.equal(request.headers.has("Authorization"), false);
  assert.equal(request.headers.has("Cache-Control"), false);
  assert.equal(request.headers.has("User-Agent"), false);
  assert.match(source.attribution, /https:\/\/www.openstreetmap.org\/copyright/);
  // The canonical endpoint must also be allowed by the production CSP.
  const server = readFileSync(new URL("../server/server.mjs", import.meta.url), "utf8");
  assert.match(contentSecurityPolicy(), /img-src[^;]+https:\/\/tile.openstreetmap.org;/);
  assert.match(contentSecurityPolicy(), /connect-src[^;]+https:\/\/tile.openstreetmap.org[ ;]/);
  assert.match(server, /setHeader\("referrer-policy", "no-referrer"\)/);
});

test("the map referrer exception cannot apply to another host or downgrade to HTTP", () => {
  for (const url of ["https://tile.openstreetmap.org.evil.test/1.png", "https://other.example/map", "http://tile.openstreetmap.org/1.png", "/api/journeys"]) {
    assert.deepEqual(mapTileRequest(url), { url });
  }
});

test("route geometry and bounds remain available with no basemap or network", () => {
  const leg = { fromCoords: [-71.055, 42.352], toCoords: [-71.119, 42.374], geometry: "invalid" };
  const journey = { fromCoords: leg.fromCoords, toCoords: leg.toCoords, legs: [leg] };
  assert.deepEqual(legGeometry(leg, journey), [leg.fromCoords, leg.toCoords]);
  assert.deepEqual(journeyBounds(journey), [[-71.119, 42.352], [-71.055, 42.374]]);
});
