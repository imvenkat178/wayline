import { fetchBounded, mbtaVehicles, mbtaAlerts } from "../adapters/providers.mjs";
import { DomainError } from "../domain/journeys.mjs";
import { cities } from "../catalog.mjs";
import { otpPlan } from "./routing.mjs";
const cache = new Map(),
  pending = new Map(),
  states = new Map();
export function travelHealth() {
  return {
    services: [
      "MBTA places",
      "MBTA predictions",
      "MBTA vehicles",
      "MBTA disruptions",
      "Boston routing",
      "NWS weather",
    ].map((name) => ({
      name,
      status:
        name === "Boston routing" && !process.env.OTP_GRAPHQL_URL
          ? "not configured"
          : "not checked",
      lastSuccess: null,
      coverage: "Greater Boston / MBTA",
      ...states.get(name),
      ageSeconds: states.get(name)?.lastSuccess
        ? Math.round((Date.now() - Date.parse(states.get(name).lastSuccess)) / 1000)
        : null,
    })),
  };
}
async function json(url, options) {
  return JSON.parse((await fetchBounded(url, options)).toString());
}
async function cached(name, key, ttl, fn) {
  if (process.env.ENABLE_EXTERNAL_FEEDS === "false")
    throw new DomainError("External feeds are disabled.", 503, "FEED_DISABLED");
  const old = cache.get(key);
  if (old && Date.now() - old.at < ttl) return old.value;
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    try {
      const raw = await fn();
      const at = Date.now();
      const value = {
        ...raw,
        source: name,
        fetchedAt: raw.fetchedAt ?? new Date(at).toISOString(),
        cache: raw.cache ?? "fresh",
      };
      cache.set(key, { at, value });
      if (cache.size > 250) cache.delete(cache.keys().next().value);
      states.set(name, {
        status: value.cache === "stale" ? "unavailable" : "connected",
        lastSuccess: value.fetchedAt,
        lastChecked: new Date(at).toISOString(),
      });
      return value;
    } catch (e) {
      states.set(name, {
        status: "unavailable",
        lastSuccess: states.get(name)?.lastSuccess ?? old?.value.fetchedAt ?? null,
        lastChecked: new Date().toISOString(),
        reason: e.code ?? "UPSTREAM_ERROR",
      });
      if (old && Date.now() - old.at < ttl * 5)
        return {
          ...old.value,
          cache: "stale",
          warning: "Provider unavailable. Previously observed data shown.",
        };
      throw e;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, task);
  return task;
}
function mbta(path) {
  return json("https://api-v3.mbta.com" + path, {
    headers: process.env.MBTA_API_KEY ? { "x-api-key": process.env.MBTA_API_KEY } : {},
  });
}
export async function places(q = "") {
  const data = await cached("MBTA places", "places", 3600000, async () => {
    const r = await mbta("/stops?filter[location_type]=1&page[limit]=500");
    return {
      places: r.data
        .filter(
          (x) => Number.isFinite(x.attributes.latitude) && Number.isFinite(x.attributes.longitude),
        )
        .map((x) => ({
          id: x.id,
          name: x.attributes.name,
          station: x.attributes.name,
          state: "MA",
          lat: x.attributes.latitude,
          lon: x.attributes.longitude,
          timezone: "America/New_York",
          source: "MBTA V3",
        })),
    };
  });
  const query = q.toLowerCase().trim();
  return {
    ...data,
    places: data.places
      .filter((x) => !query || x.name.toLowerCase().includes(query) || x.id === q)
      .slice(0, 100),
  };
}
export async function resolvePlace(value) {
  if (typeof value === "object") return value;
  const city = cities.find((x) => x.id === value);
  if (city) return city;
  const data = await places(value);
  const exact = data.places.find(
    (x) => x.id === value || x.name.toLowerCase() === value.toLowerCase(),
  );
  if (exact) return exact;
  if (data.places.length === 1) return data.places[0];
  throw new DomainError("Choose an exact Boston station or map location.", 400, "PLACE_REQUIRED");
}
export async function predictions({ tripId }) {
  return cached("MBTA predictions", "prediction:" + tripId, 15000, async () => {
    const r = await mbta(
      "/predictions?filter[trip]=" + encodeURIComponent(tripId) + "&page[limit]=100",
    );
    return {
      predictions: r.data.map((x) => ({
        id: x.id,
        tripId: x.relationships?.trip?.data?.id ?? tripId,
        stopId: x.relationships?.stop?.data?.id ?? null,
        arrival: x.attributes.arrival_time ?? null,
        departure: x.attributes.departure_time ?? null,
        cancelled: /CANCELLED|SKIPPED/.test(x.attributes.schedule_relationship ?? ""),
        status: x.attributes.status ?? null,
      })),
    };
  });
}
export async function nwsWeather({ lat, lon }) {
  return cached(
    "NWS weather",
    "weather:" + lat.toFixed(2) + ":" + lon.toFixed(2),
    900000,
    async () => {
      const headers = { "User-Agent": "Wayline-Boston-Pilot/2.0", Accept: "application/geo+json" };
      const point = await json(
        "https://api.weather.gov/points/" + lat.toFixed(4) + "," + lon.toFixed(4),
        { headers },
      );
      const url = new URL(point.properties.forecast);
      if (url.protocol !== "https:" || url.hostname !== "api.weather.gov")
        throw new DomainError("Unexpected weather endpoint.", 502);
      const [forecast, alerts] = await Promise.all([
        json(url.href, { headers }),
        json("https://api.weather.gov/alerts/active?point=" + lat + "," + lon, { headers }),
      ]);
      return {
        periods: forecast.properties.periods.slice(0, 14),
        alerts: alerts.features.map((x) => ({
          id: x.id,
          event: x.properties.event,
          severity: x.properties.severity,
          headline: x.properties.headline,
          effective: x.properties.effective,
          expires: x.properties.expires,
        })),
      };
    },
  );
}
export async function runTravelTool(name, args) {
  if (name === "health") return travelHealth();
  if (name === "places") return places(args.q);
  if (name === "predictions") return predictions(args);
  if (name === "vehicles") return cached("MBTA vehicles", "vehicles", 15000, mbtaVehicles);
  if (name === "disruptions") return cached("MBTA disruptions", "disruptions", 30000, mbtaAlerts);
  if (name === "weather") return nwsWeather(args);
  if (name === "search")
    return cached("Boston routing", "route:" + JSON.stringify(args), 15000, async () =>
      otpPlan({ ...args, from: await resolvePlace(args.from), to: await resolvePlace(args.to) }),
    );
  throw new DomainError("Unknown travel tool.", 400);
}
