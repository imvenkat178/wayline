import test from "node:test";
import assert from "node:assert/strict";
import {
  agencies,
  cities,
  corridors,
  stations,
  agenciesForCorridor,
  operatorForCorridor,
  connectedCities,
  discoverAgencies,
  stationGuide,
} from "../server/catalog.mjs";
import { sampleSearch } from "../server/domain/journeys.mjs";

// Phase 11 (roadmap feature 44, "Transport Knowledge Graph"). These exercise the real,
// ID-based relationships added between corridors/agencies/stations, not just the flat seed
// lists that already existed. See docs/adr/0007-catalog-knowledge-graph.md for why this
// replaced the originally-planned "split user records into indexed tables" version of Phase
// 11: that would have forced a real privacy tradeoff (indexing an encrypted field means storing
// it in plaintext), while this graph is over static, non-personal reference data only.

test("every corridor resolves to at least one real agency id, not an empty or dangling edge", () => {
  for (const corridor of corridors) {
    assert.ok(Array.isArray(corridor.agencyIds));
    assert.ok(corridor.agencyIds.length > 0, `corridor ${corridor.id} has no agency edges`);
    for (const id of corridor.agencyIds) {
      assert.ok(
        agencies.some((a) => a.id === id),
        `corridor ${corridor.id} references dangling agency id ${id}`,
      );
    }
  }
});

test("agenciesForCorridor resolves real agency objects by id, not by name matching", () => {
  const sfOak = corridors.find((c) => c.id === "sf-oak");
  const resolved = agenciesForCorridor(sfOak);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].name, "BART");
});

test("operatorForCorridor picks a real, mode-appropriate agency when the graph has one", () => {
  const sfOak = corridors.find((c) => c.id === "sf-oak");
  assert.equal(operatorForCorridor(sfOak, "train")?.name, "BART");
  const seaBai = corridors.find((c) => c.id === "sea-bai");
  assert.equal(operatorForCorridor(seaBai, "ferry")?.name, "Washington State Ferries");
  const laLax = corridors.find((c) => c.id === "la-lax");
  // LA Metro genuinely operates both rail and bus service -- both modes should resolve to it.
  assert.equal(operatorForCorridor(laLax, "train")?.name, "LA Metro");
  assert.equal(operatorForCorridor(laLax, "bus")?.name, "LA Metro");
});

test("operatorForCorridor returns null (never a guess) when the graph has no agency for that mode", () => {
  const sfOak = corridors.find((c) => c.id === "sf-oak");
  // BART only models trains -- there is no real seeded bus operator for this corridor.
  assert.equal(operatorForCorridor(sfOak, "bus"), null);
});

test("Washington State Ferries is a real seeded agency, not just a string used elsewhere", () => {
  // This agency was referenced by name in operatorLinks and hardcoded in journeys.mjs's sample
  // search before this pass, but never actually existed in the agency seed list itself.
  const wsf = agencies.find((a) => a.name === "Washington State Ferries");
  assert.ok(wsf, "Washington State Ferries should now be a real seeded agency");
  assert.equal(wsf.state, "WA");
  assert.deepEqual(wsf.modes, ["ferry"]);
});

test("connectedCities finds real corridor-connected neighbors and nothing else", () => {
  const neighbors = connectedCities("la")
    .map((c) => c.id)
    .sort();
  assert.deepEqual(neighbors, ["lax", "sj"]);
  assert.deepEqual(
    connectedCities("bos").map((c) => c.id),
    ["nyc"],
  );
  assert.deepEqual(connectedCities("atl"), []);
});

test("discoverAgencies prefers real corridor graph edges for a known corridor, still includes national carriers", () => {
  const found = discoverAgencies("sf", "oak").map((a) => a.name);
  assert.ok(found.includes("BART"));
  assert.ok(found.includes("Amtrak"), "national carriers should still be included");
});

test("discoverAgencies still falls back to name-matching for city pairs with no sample corridor", () => {
  // Atlanta has no sample corridor at all, so this must fall back to the pre-existing
  // name-substring behavior rather than returning only national agencies.
  const found = discoverAgencies("atl", null).map((a) => a.name);
  const nonNational = found.filter(
    (n) => !["Amtrak", "Greyhound", "FlixBus", "OurBus", "Megabus", "Peter Pan"].includes(n),
  );
  assert.ok(
    nonNational.length > 0,
    "expected a locally-matched Atlanta agency, not just national carriers",
  );
});

test("stations are real entities linked to a city id, each with resolvable agency ids", () => {
  assert.equal(stations.length, cities.length);
  for (const station of stations) {
    assert.ok(cities.some((c) => c.id === station.cityId));
    for (const id of station.agencyIds) {
      assert.ok(agencies.some((a) => a.id === id));
    }
  }
});

test("stationGuide exposes the station's real agencyIds, not just facility placeholders", () => {
  const guide = stationGuide("la");
  assert.ok(guide);
  assert.ok(Array.isArray(guide.agencyIds));
  const laMetro = agencies.find((a) => a.name === "LA Metro");
  assert.ok(guide.agencyIds.includes(laMetro.id));
});

test("stationGuide still returns null for an unknown city id", () => {
  assert.equal(stationGuide("not-a-real-city"), null);
});

test("sampleSearch's main leg operator is now grounded in the real corridor graph for train/ferry variants", () => {
  const result = sampleSearch({ from: "sf", to: "oak", departure: "2026-06-01T18:00:00Z" });
  const trainLegs = result.journeys
    .map((j) => j.legs.find((l) => l.id === "main"))
    .filter((l) => l.mode === "train");
  assert.ok(trainLegs.length > 0);
  for (const leg of trainLegs) assert.equal(leg.operator, "BART");
});

test("sampleSearch keeps the original fallback operator for a mode the graph has no answer for", () => {
  const result = sampleSearch({ from: "sf", to: "oak", departure: "2026-06-01T18:00:00Z" });
  const busLegs = result.journeys
    .map((j) => j.legs.find((l) => l.id === "main"))
    .filter((l) => l.mode === "bus");
  assert.ok(busLegs.length > 0);
  for (const leg of busLegs) assert.ok(["Greyhound", "FlixBus"].includes(leg.operator));
});

test("sampleSearch for a long-distance corridor is unaffected (Amtrak/Greyhound/FlixBus, as before)", () => {
  const result = sampleSearch({ from: "la", to: "sj", departure: "2026-06-01T18:00:00Z" });
  const mains = result.journeys.map((j) => j.legs.find((l) => l.id === "main"));
  for (const leg of mains) {
    if (leg.mode === "train") assert.equal(leg.operator, "Amtrak");
    else assert.ok(["Greyhound", "FlixBus"].includes(leg.operator));
  }
});
