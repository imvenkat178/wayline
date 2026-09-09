import { DomainError, text, integer } from "./domain/journeys.mjs";
export function validTime(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new DomainError(`Enter a valid ${label}.`);
  return new Date(value).toISOString();
}
export function validateRecord(kind, b) {
  if (kind === "favorite")
    return {
      name: text(b.name, "Shortcut name", 60),
      from: text(b.from, "Origin", 30),
      to: text(b.to, "Destination", 30),
    };
  if (kind === "traveler")
    return {
      name: text(b.name, "Name", 100),
      fareClass: ["adult", "student", "senior", "military", "accessibility", "child"].includes(
        b.fareClass,
      )
        ? b.fareClass
        : "adult",
      assistance: Boolean(b.assistance),
      verification: "not verified",
    };
  if (kind === "contact")
    return {
      name: text(b.name, "Name", 100),
      contact: text(b.contact, "Contact address or number", 200),
      consent: Boolean(b.consent),
      delivery: "not configured",
    };
  if (kind === "commute") {
    const days = b.days;
    if (
      !Array.isArray(days) ||
      !days.length ||
      days.some((x) => !Number.isInteger(x) || x < 0 || x > 6)
    )
      throw new DomainError("Choose valid commute days.");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time ?? ""))
      throw new DomainError("Choose a valid commute time.");
    const timezone = text(b.timezone ?? "America/Los_Angeles", "Timezone", 80);
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      throw new DomainError("Invalid timezone.");
    }
    return {
      name: text(b.name, "Commute name", 60),
      from: text(b.from, "Origin", 30),
      to: text(b.to, "Destination", 30),
      time: b.time,
      days: [...new Set(days)],
      enabled: b.enabled !== false,
      timezone,
    };
  }
  if (kind === "pass")
    return {
      name: text(b.name, "Pass name", 80),
      operator: text(b.operator, "Operator", 80),
      costCents: integer(b.costCents, "Cost", 0, 100000),
      renewal: validTime(b.renewal, "renewal date"),
      autoRenew: Boolean(b.autoRenew),
      source: "self-reported",
    };
  if (kind === "ticket")
    return {
      operator: text(b.operator, "Operator", 80),
      service: text(b.service, "Service", 80),
      confirmation: text(b.confirmation, "Confirmation code", 100),
      passenger: text(b.passenger, "Passenger", 100),
      departure: validTime(b.departure, "departure time"),
      origin: text(b.origin, "Origin", 160),
      destination: text(b.destination, "Destination", 160),
      seat: String(b.seat ?? "").slice(0, 40),
      coach: String(b.coach ?? "").slice(0, 40),
      platform: String(b.platform ?? "").slice(0, 40),
      journeyId: String(b.journeyId ?? "").slice(0, 100),
      // Optional, self-reported: what the traveler says they actually paid. There is no
      // payment integration anywhere in this codebase (bookingConfirmed is never set true),
      // so this is the only amount-paid data available at all; recovery economics uses it,
      // when present, in place of the abstract itinerary estimate (see recoveryCost()).
      paidCents:
        b.paidCents === undefined || b.paidCents === null
          ? null
          : integer(b.paidCents, "Paid amount", 0, 1000000),
      validity: "self-reported",
      source: "manual import; not verified by operator",
      barcode: null,
    };
  if (kind === "report") {
    const types = [
      "bus-missing",
      "stop-moved",
      "elevator-broken",
      "boarding-location",
      "crowding",
      "on-board",
    ];
    if (!types.includes(b.type)) throw new DomainError("Choose a report type.");
    if (!b.consent) throw new DomainError("Consent is required to contribute a report.");
    return {
      type: b.type,
      station: text(b.station, "Station or stop", 160),
      service: text(b.service, "Service", 80),
      note: String(b.note ?? "").slice(0, 1000),
      consent: true,
      source: "unverified rider report",
      confidence: null,
      observedAt: new Date().toISOString(),
    };
  }
  throw new DomainError("Unsupported record type.");
}
export function receipt(j) {
  return {
    journeyId: j.id,
    from: j.from,
    to: j.to,
    state: j.state,
    dataMode: j.dataMode,
    scheduled: { departure: j.departure, arrival: j.arrival },
    price: j.price,
    events: j.events ?? [],
    issuedAt: new Date().toISOString(),
    notice: "Journey record, not a carrier-issued ticket or tax invoice.",
  };
}
