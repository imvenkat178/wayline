/** Curated discovery seed, NOT an assertion of live nationwide coverage. */
export const states = Object.entries({
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
}).map(([code, name]) => ({ code, name }));
const seed = [
  ["AL", "Birmingham", "BJCTA"],
  ["AK", "Anchorage", "People Mover"],
  ["AZ", "Phoenix", "Valley Metro"],
  ["AR", "Little Rock", "Rock Region METRO"],
  ["CA", "Los Angeles", "LA Metro"],
  ["CA", "San Jose", "VTA"],
  ["CA", "San Francisco", "SFMTA"],
  ["CA", "Oakland", "BART"],
  ["CO", "Denver", "RTD"],
  ["CT", "Hartford", "CTtransit"],
  ["DE", "Wilmington", "DART First State"],
  ["DC", "Washington", "WMATA"],
  ["FL", "Miami", "Miami-Dade Transit"],
  ["GA", "Atlanta", "MARTA"],
  ["HI", "Honolulu", "TheBus"],
  ["ID", "Boise", "Valley Regional Transit"],
  ["IL", "Chicago", "CTA"],
  ["IL", "Chicago", "Metra"],
  ["IN", "Indianapolis", "IndyGo"],
  ["IA", "Des Moines", "DART"],
  ["KS", "Wichita", "Wichita Transit"],
  ["KY", "Louisville", "TARC"],
  ["LA", "New Orleans", "RTA"],
  ["ME", "Portland", "Greater Portland METRO"],
  ["MD", "Baltimore", "Maryland Transit Administration"],
  ["MA", "Boston", "MBTA"],
  ["MI", "Detroit", "DDOT"],
  ["MN", "Minneapolis", "Metro Transit"],
  ["MS", "Jackson", "JTRAN"],
  ["MO", "St. Louis", "Metro Transit"],
  ["MT", "Missoula", "Mountain Line"],
  ["NE", "Omaha", "Metro"],
  ["NV", "Las Vegas", "RTC Southern Nevada"],
  ["NH", "Manchester", "Manchester Transit Authority"],
  ["NJ", "Newark", "NJ TRANSIT"],
  ["NM", "Albuquerque", "ABQ RIDE"],
  ["NY", "New York", "MTA"],
  ["NC", "Charlotte", "CATS"],
  ["ND", "Fargo", "MATBUS"],
  ["OH", "Columbus", "COTA"],
  ["OK", "Oklahoma City", "EMBARK"],
  ["OR", "Portland", "TriMet"],
  ["PA", "Philadelphia", "SEPTA"],
  ["RI", "Providence", "RIPTA"],
  ["SC", "Charleston", "CARTA"],
  ["SD", "Sioux Falls", "Sioux Area Metro"],
  ["TN", "Nashville", "WeGo Public Transit"],
  ["TX", "Dallas", "DART"],
  ["UT", "Salt Lake City", "UTA"],
  ["VT", "Burlington", "Green Mountain Transit"],
  ["VA", "Richmond", "GRTC"],
  ["WA", "Seattle", "King County Metro"],
  ["WA", "Seattle", "Sound Transit"],
  ["WA", "Bainbridge Island", "Washington State Ferries"],
  ["WV", "Charleston", "Kanawha Valley Regional Transportation Authority"],
  ["WI", "Milwaukee", "MCTS"],
  ["WY", "Cheyenne", "Cheyenne Transit Program"],
  ["US", "National", "Amtrak"],
  ["US", "National", "Greyhound"],
  ["US", "National", "FlixBus"],
  ["US", "National", "OurBus"],
  ["US", "National", "Megabus"],
  ["US", "Northeast", "Peter Pan"],
];
// Known, real transport modes for the specific agencies this catalog's sample corridors and
// station guide can actually name with confidence -- see agenciesForCorridor()/
// operatorForCorridor() below. Not populated for the rest of the 50-state seed; see the comment
// on `agencies` for why.
const modesByAgencyName = {
  Amtrak: ["train"],
  Greyhound: ["bus"],
  FlixBus: ["bus"],
  OurBus: ["bus"],
  Megabus: ["bus"],
  "Peter Pan": ["bus"],
  "LA Metro": ["train", "bus"],
  VTA: ["train", "bus"],
  BART: ["train"],
  MBTA: ["train", "bus"],
  "Washington State Ferries": ["ferry"],
};
export const agencies = seed.map(([state, city, name], i) => ({
  id: `agency-${i + 1}`,
  name,
  state,
  city,
  modes: modesByAgencyName[name] ?? [],
  coverage: "discovery-seed",
  staticFeed: "unverified",
  vehiclePositions: name === "MBTA" ? "adapter available" : "not configured",
  tripUpdates: "not configured",
  alerts: name === "MBTA" ? "adapter available" : "not configured",
  ticketing: "provider required",
  fares: "unverified",
  accessibility: "unverified",
  crowding: "unverified",
  lastSuccess: null,
  source: name === "MBTA" ? "https://api-v3.mbta.com/" : null,
}));
export const cities = [
  ["la", "Los Angeles", "CA", 34.056, -118.236, "America/Los_Angeles", "Union Station"],
  ["sj", "San Jose", "CA", 37.33, -121.902, "America/Los_Angeles", "Diridon Station"],
  [
    "sf",
    "San Francisco",
    "CA",
    37.776,
    -122.395,
    "America/Los_Angeles",
    "Salesforce Transit Center",
  ],
  [
    "oak",
    "Oakland",
    "CA",
    37.804,
    -122.272,
    "America/Los_Angeles",
    "12th Street / Oakland City Center",
  ],
  ["bos", "Boston", "MA", 42.352, -71.055, "America/New_York", "South Station"],
  ["nyc", "New York", "NY", 40.751, -73.994, "America/New_York", "Moynihan Train Hall"],
  [
    "ind",
    "Indianapolis",
    "IN",
    39.765,
    -86.158,
    "America/Indiana/Indianapolis",
    "Julia M. Carson Transit Center",
  ],
  ["chi", "Chicago", "IL", 41.879, -87.64, "America/Chicago", "Union Station"],
  ["sea", "Seattle", "WA", 47.602, -122.339, "America/Los_Angeles", "Colman Dock"],
  [
    "bai",
    "Bainbridge Island",
    "WA",
    47.623,
    -122.511,
    "America/Los_Angeles",
    "Bainbridge Island Ferry Terminal",
  ],
  ["atl", "Atlanta", "GA", 33.753, -84.391, "America/New_York", "Five Points"],
  [
    "lax",
    "LAX Airport",
    "CA",
    33.943,
    -118.409,
    "America/Los_Angeles",
    "LAX / Metro Transit Center",
  ],
].map(([id, name, state, lat, lon, timezone, station]) => ({
  id,
  name,
  state,
  lat,
  lon,
  timezone,
  station,
}));
// Real agencies plausibly serving each sample corridor, by name -- resolved to ids just below
// once `agencies` exists, rather than hardcoded ids (which would silently drift if the seed
// list above is ever reordered). This is the actual "relationships let Wayline reason across
// operators" piece of roadmap feature 44 (Transport Knowledge Graph): previously nothing in
// this catalog linked a corridor to who might run it at all, and journeys.mjs's sample search
// picked an operator name from a hardcoded mode/index guess with no connection to this data.
// Still illustrative/unverified like every other sample in this file (see dataMode:
// "illustrative" on sampleSearch's output) -- this only grounds the *choice* of plausible
// operator in a real relationship, not a claim that these are the only or definitive carriers.
const corridorAgencyNames = {
  "la-sj": ["Amtrak", "Greyhound", "FlixBus"],
  "bos-nyc": ["Amtrak", "Greyhound", "FlixBus"],
  "ind-chi": ["Amtrak", "Megabus", "Greyhound"],
  "sf-oak": ["BART"],
  "sea-bai": ["Washington State Ferries"],
  "la-lax": ["LA Metro"],
};
export const corridors = [
  { from: "la", to: "sj", minutes: 470, km: 550 },
  { from: "bos", to: "nyc", minutes: 260, km: 345 },
  { from: "ind", to: "chi", minutes: 210, km: 290 },
  { from: "sf", to: "oak", minutes: 37, km: 17 },
  { from: "sea", to: "bai", minutes: 48, km: 14 },
  { from: "la", to: "lax", minutes: 85, km: 29 },
].map((corridor) => ({ ...corridor, id: `${corridor.from}-${corridor.to}` }));
export const operatorLinks = {
  Amtrak: "https://www.amtrak.com/",
  Greyhound: "https://www.greyhound.com/",
  FlixBus: "https://www.flixbus.com/",
  "LA Metro": "https://www.metro.net/",
  VTA: "https://www.vta.org/",
  MBTA: "https://www.mbta.com/",
  BART: "https://www.bart.gov/",
  "Washington State Ferries": "https://wsdot.wa.gov/travel/washington-state-ferries",
  OurBus: "https://www.ourbus.com/",
  Megabus: "https://us.megabus.com/",
  "Peter Pan": "https://peterpanbus.com/",
};
export const defaultPreferences = {
  priority: "balanced",
  budgetCents: 8500,
  maxTransfers: 3,
  maxWalkMinutes: 25,
  minConnectionMinutes: 8,
  walkSpeed: 1.2,
  wheelchair: false,
  stepFree: false,
  avoidStairs: false,
  elevatorRequired: false,
  lowFloor: false,
  transferAssistance: false,
  serviceAnimal: false,
  visualAnnouncements: false,
  audioNavigation: false,
  lessCrowded: false,
  preferTrain: false,
  avoidBus: false,
  nightWalking: true,
  coveredTransfers: false,
  riskTolerance: "balanced",
  importance: "normal",
  language: "en",
  visitor: false,
  notifyCritical: true,
  notifyInfo: false,
  // Whether a push notification (see server/push.mjs) shows the real alert title/body, or a
  // generic phrase. Push can surface on a locked screen, a materially wider exposure than the
  // in-app alert list, so this defaults off even though notifyCritical/notifyInfo are on.
  pushDetails: false,
  quietStart: "22:00",
  quietEnd: "07:00",
  // R07: the IANA zone quiet hours are evaluated in. A push notification is delivered by this
  // server while the account's own device may be asleep or offline, so "device time" -- what the
  // foreground UI used exclusively before this fix -- isn't something the server can observe;
  // this is what makes quiet hours actually enforceable for push, not just in-app polling. The
  // frontend also switches to formatting against this same zone (see src/App.tsx) so the two
  // notification paths agree, instead of one using the browser's clock and the other guessing.
  // Defaults to a reasonable fallback; Profile.tsx pre-fills it with the browser's own detected
  // zone (Intl.DateTimeFormat().resolvedOptions().timeZone) for a new account, which is usually
  // the same zone the old "device time" framing already implied.
  timezone: "America/Los_Angeles",
  historyDays: 90,
  saveHistory: true,
  shareLocation: false,
  autoRecovery: false,
  recoveryLimitCents: 1000,
  emergencyMinutes: 45,
};
// Real ID-based graph edges (Phase 11, roadmap feature 44): a corridor's `agencyIds` names
// exactly which seeded agencies plausibly serve it, resolved once here rather than re-scanning
// `agencies` by name on every call.
const corridorAgencyIds = Object.fromEntries(
  Object.entries(corridorAgencyNames).map(([corridorId, names]) => [
    corridorId,
    names.map((name) => agencies.find((a) => a.name === name)?.id).filter(Boolean),
  ]),
);
for (const corridor of corridors) corridor.agencyIds = corridorAgencyIds[corridor.id] ?? [];

/** Real agencies linked to a corridor by id, not by matching strings. */
export function agenciesForCorridor(corridor) {
  const ids = new Set(corridor?.agencyIds ?? []);
  return agencies.filter((a) => ids.has(a.id));
}

/**
 * The most plausible real operator for a corridor + mode, using the corridor's own agency
 * graph edges. Returns null (never a guess) when the graph has no agency for that corridor/mode
 * combination -- callers decide their own fallback, same as they did before this function
 * existed.
 */
export function operatorForCorridor(corridor, mode) {
  return agenciesForCorridor(corridor).find((a) => (a.modes ?? []).includes(mode)) ?? null;
}

/** Cities directly connected to `cityId` by a known sample corridor. */
export function connectedCities(cityId) {
  return corridors
    .filter((c) => c.from === cityId || c.to === cityId)
    .map((c) => cities.find((city) => city.id === (c.from === cityId ? c.to : c.from)))
    .filter(Boolean);
}

export function discoverAgencies(from, to) {
  const endpoints = [from, to].filter(Boolean).map((id) => cities.find((c) => c.id === id));
  // Where a real sample corridor connects these two cities, prefer its actual graph edges (a
  // real relationship) over guessing from city-name substrings.
  const corridor =
    endpoints.length === 2 &&
    corridors.find(
      (c) =>
        (c.from === endpoints[0]?.id && c.to === endpoints[1]?.id) ||
        (c.to === endpoints[0]?.id && c.from === endpoints[1]?.id),
    );
  const graphAgencies = corridor ? agenciesForCorridor(corridor) : [];
  // Fall back to the original name-substring match for the other ~44 states that have no
  // sample corridor at all -- the broad 50-state discovery seed was never meant to have a real
  // corridor edge for every city, so this fallback stays the only way to surface anything for
  // most of it.
  const names = new Set(endpoints.map((c) => c?.name));
  const fallbackAgencies = agencies.filter((a) => names.has(a.city));
  const national = agencies.filter((a) => a.state === "US");
  const byId = new Map();
  for (const a of [...graphAgencies, ...fallbackAgencies, ...national]) byId.set(a.id, a);
  return [...byId.values()];
}
// A Station as its own entity (Phase 11, roadmap feature 44), not just an inline field on City.
// Each sample city models exactly one station today (matching this project's actual sample
// data -- a real city can have several, but this catalog has no verified data for that, so it
// isn't invented here), linked to the agencies known to serve that city by the same
// name-matching `discoverAgencies` already used for the broader 50-state seed.
export const stations = cities.map((city) => ({
  id: city.id,
  cityId: city.id,
  name: city.station,
  lat: city.lat,
  lon: city.lon,
  agencyIds: agencies.filter((a) => a.city === city.name).map((a) => a.id),
}));

export function stationGuide(cityId) {
  const city = cities.find((c) => c.id === cityId);
  const station = stations.find((s) => s.id === cityId);
  if (!city || !station) return null;
  return {
    id: city.id,
    name: city.station,
    city: city.name,
    lat: city.lat,
    lon: city.lon,
    agencyIds: station.agencyIds,
    source: "sample guide — verify signs with station staff",
    official: false,
    facilities: [
      { name: "Accessible entrance", status: "Verify on arrival" },
      { name: "Elevator", status: "Status unknown" },
      { name: "Restrooms", status: "Check station signs" },
      { name: "Waiting area", status: "Hours unverified" },
      { name: "Food & water", status: "Availability unverified" },
      { name: "Charging / Wi-Fi", status: "Availability unverified" },
      { name: "Ticket desk", status: "Check operator hours" },
      { name: "Baggage storage", status: "Provider dependent" },
      { name: "Rideshare pickup", status: "Follow local signs" },
    ],
    directions: [
      "Find the station’s posted departure board.",
      "Match the operator, service number and destination on your ticket.",
      "Use the signed accessible path if you need step-free access.",
      "Confirm the boarding area with station staff before proceeding.",
    ],
    parking: { rateCents: null, availability: "unknown", evChargers: "not connected" },
  };
}
