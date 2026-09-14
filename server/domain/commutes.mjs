import { DomainError } from "./journeys.mjs";
import { cities } from "../catalog.mjs";
import { placeSchema } from "../travel/schemas.mjs";

// Resolve a saved shortcut through the same private travel client as trip search.
// Station coordinates come from the provider; only explicit coordinate endpoints use user input.
export async function resolveSavedRoute(value, travel) {
  if (value.mode === "sample") {
    if (!cities.some(c => c.id === value.from) || !cities.some(c => c.id === value.to) || value.from === value.to)
      throw new DomainError("Choose different supported endpoints.");
    return { ...value, fromPlace: undefined, toPlace: undefined };
  }
  const resolve = async (id, point) => {
    if (id.startsWith("coordinate:") && point) {
      const parsed = placeSchema.safeParse(point);
      if (!parsed.success || point.id !== id) throw new DomainError("Choose valid coordinates.");
      const p = parsed.data;
      if (p.lat < 41 || p.lat > 43.5 || p.lon < -73.6 || p.lon > -69)
        throw new DomainError("Saved live routes currently cover the Boston / MBTA region.");
      return { ...p, timezone: "America/New_York", source: "Traveler coordinates" };
    }
    const data = await travel.call("places", { q: id });
    const p = data.places.find(p => p.id === id || p.name.toLowerCase() === id.toLowerCase());
    if (!p) throw new DomainError("Select an exact Boston station before saving.");
    return p;
  };
  const [fromPlace, toPlace] = await Promise.all([resolve(value.from, value.fromPlace), resolve(value.to, value.toPlace)]);
  if (fromPlace.id === toPlace.id || (fromPlace.lat === toPlace.lat && fromPlace.lon === toPlace.lon))
    throw new DomainError("Choose different supported endpoints.");
  return { ...value, from: fromPlace.id, to: toPlace.id, fromPlace, toPlace };
}

// Enumerate local calendar days, then verify candidate UTC instants. Nonexistent spring
// times are skipped; an ambiguous fall time is scheduled once, at its first occurrence.
export function nextCommuteDeparture(commute, now = Date.now()) {
  if (!commute.enabled) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: commute.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const parts = ms => Object.fromEntries(formatter.formatToParts(ms).map(p => [p.type, p.value]));
  const wall = p => Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const today = parts(now), [hour, minute] = commute.time.split(":").map(Number);
  for (let day = 0; day < 9; day++) {
    const target = Date.UTC(+today.year, +today.month - 1, +today.day + day, hour, minute);
    if (!commute.days.includes(new Date(target).getUTCDay())) continue;
    const candidates = [...new Set([-36, 0, 36].map(hours => {
      const probe = target + hours * 3600000;
      return target - (wall(parts(probe)) - probe);
    }))].filter(ms => wall(parts(ms)) === target).sort((a, b) => a - b);
    if (candidates[0] >= now) return new Date(candidates[0]).toISOString();
  }
  return null;
}
