import { z } from "zod";
const time = z.string().datetime({ offset: true });
export const placeSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  timezone: z.string().default("America/New_York"),
  source: z.string().optional(),
  station: z.string().optional(),
  state: z.string().optional(),
});
export const endpointSchema = z.union([z.string().min(1).max(160), placeSchema]);
export const searchSchema = z.object({
  from: endpointSchema,
  to: endpointSchema,
  departure: time,
  deadline: time.optional(),
  travelers: z.number().int().min(1).max(12).default(1),
  bags: z.number().int().min(0).max(12).default(0),
  preferences: z.record(z.unknown()).default({}),
});
const legSchema = z
  .object({
    id: z.string(),
    mode: z.string(),
    from: z.string(),
    to: z.string(),
    departure: time,
    arrival: time,
    durationMinutes: z.number().nonnegative(),
  })
  .passthrough();
export const routeSchema = z
  .object({
    id: z.string(),
    from: z.string(),
    to: z.string(),
    departure: time,
    arrival: time,
    fromCoords: z.tuple([z.number(), z.number()]),
    toCoords: z.tuple([z.number(), z.number()]),
    dataMode: z.literal("provider"),
    legs: z.array(legSchema).min(1),
    price: z.object({ totalCents: z.number().int().nonnegative().nullable() }).passthrough(),
  })
  .passthrough();
const envelope = z.object({
  source: z.string(),
  fetchedAt: time,
  cache: z.enum(["fresh", "stale"]),
  warning: z.string().optional(),
  reason: z.string().optional(),
  coverageLimited: z.boolean().optional(),
});
export const definitions = {
  places: {
    input: z.object({ q: z.string().max(200).default("") }),
    output: envelope.extend({ places: z.array(placeSchema) }),
    description: "Find Boston MBTA stations by name or ID.",
  },
  search: {
    input: searchSchema,
    output: envelope.extend({
      journeys: z.array(routeSchema),
      dataMode: z.literal("provider"),
      excluded: z.array(z.object({ name: z.string(), reason: z.string() })),
    }),
    description:
      "Search actual Boston transit schedules and walking connections. Unknown fares remain unknown.",
  },
  predictions: {
    input: z.object({ tripId: z.string().min(1).max(160) }),
    output: envelope.extend({
      predictions: z.array(
        z
          .object({
            id: z.string(),
            tripId: z.string(),
            stopId: z.string().nullable(),
            arrival: time.nullable(),
            departure: time.nullable(),
            cancelled: z.boolean(),
          })
          .passthrough(),
      ),
    }),
    description: "Read MBTA departure predictions for an exact trip.",
  },
  vehicles: {
    input: z.object({}),
    output: envelope.extend({
      vehicles: z.array(
        z.object({ id: z.string(), lat: z.number(), lon: z.number() }).passthrough(),
      ),
    }),
    description: "Read MBTA vehicle measurements with timestamps.",
  },
  disruptions: {
    input: z.object({}),
    output: envelope.extend({
      alerts: z.array(
        z
          .object({ id: z.string(), informed: z.array(z.record(z.unknown())).optional() })
          .passthrough(),
      ),
    }),
    description: "Read MBTA service alerts and affected entities.",
  },
  weather: {
    input: z.object({ lat: z.number().min(41).max(43.5), lon: z.number().min(-73.6).max(-69) }),
    output: envelope.extend({
      periods: z.array(
        z.object({ name: z.string(), startTime: time, shortForecast: z.string() }).passthrough(),
      ),
      alerts: z.array(
        z.object({ id: z.string(), event: z.string(), severity: z.string() }).passthrough(),
      ),
    }),
    description: "Read National Weather Service forecasts and alerts for the Boston pilot.",
  },
  health: {
    input: z.object({}),
    output: z.object({
      services: z.array(
        z
          .object({ name: z.string(), status: z.string(), lastSuccess: z.string().nullable() })
          .passthrough(),
      ),
    }),
    description: "Get measured travel service connection status.",
  },
};
