export type Mode =
  | "walk"
  | "metro"
  | "tram"
  | "bus"
  | "train"
  | "ferry"
  | "bike"
  | "scooter"
  | "drive"
  | "rideshare";
export type Page =
  "plan" | "journey" | "wallet" | "inbox" | "trips" | "commute" | "profile" | "lab" | "watch" | "assistant";
export type Risk = "low" | "moderate" | "high";
export interface Preferences {
  priority: string;
  budgetCents: number;
  maxTransfers: number;
  maxWalkMinutes: number;
  minConnectionMinutes: number;
  walkSpeed: number;
  wheelchair: boolean;
  stepFree: boolean;
  avoidStairs: boolean;
  elevatorRequired: boolean;
  lowFloor: boolean;
  transferAssistance: boolean;
  serviceAnimal: boolean;
  visualAnnouncements: boolean;
  audioNavigation: boolean;
  lessCrowded: boolean;
  preferTrain: boolean;
  avoidBus: boolean;
  nightWalking: boolean;
  coveredTransfers: boolean;
  riskTolerance: string;
  importance: string;
  language: string;
  visitor: boolean;
  notifyCritical: boolean;
  notifyInfo: boolean;
  // Whether a push or foreground notification shows the real alert title/body, or a generic
  // phrase (see server/domain/notificationPolicy.mjs's GENERIC_BODY, mirrored in App.tsx).
  // Defaults off: either can surface on a locked screen.
  pushDetails: boolean;
  quietStart: string;
  quietEnd: string;
  // R07: the IANA zone quiet hours are evaluated in (see server/domain/notificationPolicy.mjs) --
  // a push can arrive while this device is asleep, so quiet hours can't rely on this device's own
  // clock the way foreground polling used to.
  timezone: string;
  historyDays: number;
  saveHistory: boolean;
  shareLocation: boolean;
  autoRecovery: boolean;
  recoveryLimitCents: number;
  emergencyMinutes: number;
}
export interface City {
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  timezone: string;
  station: string;
}
export interface User {
  id: string;
  registered: boolean;
  name: string;
  email: string | null;
  role: string;
  preferences: Preferences;
}
export interface Capability {
  id: string;
  status: string;
  enabled: boolean;
  reason: string;
}
export interface Bootstrap {
  pilot?: boolean;
  user: User;
  csrf: string;
  cities: City[];
  states: { code: string; name: string }[];
  capabilities: Capability[];
  transitions: Record<string, string[]>;
  operatorLinks: Record<string, string>;
  // The VAPID public key for PushManager.subscribe's applicationServerKey (see server/push.mjs).
  // Null only if the server process has not finished startup configuration yet, which in
  // practice never happens by the time a browser can reach this endpoint.
  pushPublicKey: string | null;
  // Whether TOTP multi-factor authentication (server/totp.mjs) is currently enabled on this
  // account. Always false for a guest.
  mfaEnabled: boolean;
}
// One active login session for the signed-in account (server/store.mjs's sessions()), shown on
// the Security tab so a user can see and revoke access from a device they no longer have.
export interface Session {
  id: string;
  createdAt: number;
  userAgent: string | null;
  lastSeenAt: number;
  expiresAt: number;
  current: boolean;
}
export interface Tracking {
  source: string;
  observedAt: string | null;
  confidence: number | null;
  ageSeconds?: number | null;
  stale?: boolean;
  ghost?: boolean;
  label?: string;
  position?: [number, number];
}
export interface Leg {
  fromCoords?: [number, number]; toCoords?: [number, number];
  fromStopId?: string | null; toStopId?: string | null;
  serviceDate?: string | null; predictionObservedAt?: string | null; predictionStatus?: string;
  predictedDeparture?: string | null; predictedArrival?: string | null; cancelled?: boolean;
  id: string;
  mode: Mode;
  operator: string;
  service: string;
  from: string;
  to: string;
  departure: string;
  arrival: string;
  durationMinutes: number;
  priceCents: number | null;
  delayMinutes?: number;
  vehicleId?: string;
  tripId?: string;
  // Raw feed-scoped trip id as returned by the routing engine, kept for provenance/debugging;
  // tripId above is normalized for live-tracking matching (see providers.mjs normalizeGtfsId).
  routingTripId?: string | null;
  routeId?: string | null;
  // Which routing engine produced this leg (e.g. "otp", "sample"). Not the same thing as the
  // live-tracking source -- see `agency`.
  provider?: string;
  // Canonical live-tracking agency identifier (e.g. "mbta"), independent of `provider`. Only
  // legs with a recognized agency are eligible for live position matching.
  agency?: string | null;
  accessible: boolean | null;
  accessibilitySource?: string;
  crowding: number | null;
  crowdingSource?: string;
  tracking: Tracking;
  platform: string | null;
  platformSource?: string;
  boardingHint: string;
  geometry?: string;
}
export interface Connection {
  id: string;
  from: string;
  to: string;
  station: string;
  scheduledBuffer: number;
  buffer: number;
  requiredMinutes: number;
  walkMinutes: number;
  cutoffMinutes: number;
  spareMinutes: number;
  risk: Risk;
  probability: number;
  model: string;
  blocked: boolean;
}
export interface Graph {
  connections: Connection[];
  arrivalDelayMinutes: number;
  overallRisk: Risk;
  model: string;
}
export interface Leave {
  leaveAt: string;
  minutes: number;
  walkMinutes: number;
  boardingBuffer: number;
  locationBased: boolean;
}
export interface Journey {
  fromPlace?: Place; toPlace?: Place; source?: string; observedAt?: string; liveUpdatedAt?: string; liveSources?: {vehicles:string;disruptions:string};
  disruptions?: {id: string; title: string; body: string; effect: string; updatedAt: string}[];
  id: string;
  version?: number;
  state?: string;
  name: string;
  from: string;
  to: string;
  fromId: string;
  toId: string;
  fromCoords: [number, number];
  toCoords: [number, number];
  timezone: string;
  destinationTimezone: string;
  departure: string;
  arrival: string;
  durationMinutes: number;
  price: {
    totalCents: number | null;
    items: { label: string; cents: number }[];
    currency: string;
    unknown?: boolean;
  };
  travelers: number;
  bags: number;
  dataMode: "illustrative" | "provider";
  legs: Leg[];
  reliability: number | null;
  carbonKg: number | null;
  drivingCarbonKg: number | null;
  walkMinutes: number;
  transfers: number;
  accessible: boolean | null;
  bookable: boolean;
  graph: Graph;
  leave: Leave;
  privateTrip?: boolean;
  createdAt?: string;
  updatedAt?: string;
  events?: { id: string; type: string; at: string; from?: string; to?: string; source: string }[];
}
export interface SearchInput {
  fromPlace?: Place; toPlace?: Place;
  from: string;
  to: string;
  departure: string;
  deadline?: string;
  travelers: number;
  bags: number;
  mode: string;
  preferences: Preferences;
  weather?: string;
  accessibilityOutage?: boolean;
}
export interface SearchResult {
  source?: string; fetchedAt?: string; cache?: string;
  journeys: Journey[];
  excluded: { name: string; reason: string }[];
  reason?: string;
  warning?: string;
  dataMode: string;
  searchId: string;
  agencies: Agency[];
}
export interface Agency {
  id: string;
  name: string;
  state: string;
  city: string;
  modes: string[];
  staticFeed: string;
  vehiclePositions: string;
  tripUpdates: string;
  alerts: string;
  ticketing: string;
  fares: string;
  accessibility: string;
  crowding: string;
  lastSuccess: string | null;
}
export interface Alert {
  id: string;
  version: number;
  severity: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  journeyId?: string;
  dataMode?: string;
  at: string;
  createdAt: string;
}
export interface Twin {
  journeyId: string;
  state: string;
  graph: Graph;
  alerts: Alert[];
  leave: Leave;
  arrival: string;
  tracking: (Tracking & { legId: string })[];
  updatedAt: string;
  scenario?: boolean;
}
export interface Ticket {
  id: string;
  version: number;
  operator: string;
  service: string;
  confirmation: string;
  passenger: string;
  departure: string;
  origin: string;
  destination: string;
  seat: string;
  coach: string;
  platform: string;
  source: string;
  journeyId: string;
  // Roadmap features 18/19 (Phase 6): an optional barcode decoded client-side from an attached
  // photo, and the photo itself. Never verified against any issuer or carrier system -- see
  // server/records.mjs's validateTicketDocument and src/barcode.ts.
  barcodeFormat: string | null;
  barcodeText: string | null;
  document: { name: string; type: string; base64: string } | null;
}
export interface SavedItem {
  id: string;
  version: number;
  name: string;
  from?: string;
  to?: string;
  days?: number[];
  time?: string;
  timezone?: string;
  enabled?: boolean;
  fareClass?: string;
  assistance?: boolean;
  contact?: string;
  consent?: boolean;
  operator?: string;
  costCents?: number;
  renewal?: string;
  autoRenew?: boolean;
  source?: string;
}
export interface Claim {
  id: string;
  journeyId: string;
  draft: string;
  status: string;
  expensesCents: number;
  reason: string;
  submitted: boolean;
}
// Sandbox commerce scaffolding (roadmap features 34, 39-41 groundwork) -- every value here is
// synthetic, generated by server/adapters/payments.mjs's sandbox adapter. No real carrier or
// payment integration exists behind any of it; see that file's header comment.
export interface Quote {
  id: string;
  version: number;
  from: string;
  to: string;
  fareCents: number;
  feeCents: number;
  totalCents: number;
  currency: string;
  expiresAt: string;
  sandbox: true;
}
export interface Order {
  id: string;
  version: number;
  state: "HELD" | "CONFIRMED" | "EXCHANGED" | "CANCELLED" | "RECONCILED";
  quote: Quote;
  passenger: string;
  journeyId: string | null;
  authorization: { id: string; authorizedAt: string; sandbox: true };
  capture?: { id: string; capturedAt: string; sandbox: true } | null;
  refund?: { id: string; refundedAt: string; sandbox: true } | null;
  settlement?: { settlementId: string; status: string; receivedAt: string };
  sandbox: true;
  events: { id: string; type: string; from: string | null; to: string; at: string }[];
}
export interface AgentResult {
  pendingActions?: PendingAction[]; results?: AgentToolResult[];
  evidence?: {source?: string; observedAt?: string; updatedAt?: string; journeyId?: string; dataMode?: string}[];
  reply: string;
  intent: string;
  mode: string;
  actions: { type: string; label: string; payload: ParsedRequest }[];
  parsed: ParsedRequest;
  input?: string;
}
export interface ParsedRequest {
  intent: string;
  overrides: Partial<Preferences>;
  from?: string;
  to?: string;
  relativeDay?: number;
  deadlineText?: string;
}
export interface Station {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  source: string;
  official: boolean;
  facilities: { name: string; status: string }[];
  directions: string[];
  parking: { rateCents: number | null; availability: string; evChargers: string };
}

export interface Place { id: string; name: string; lat: number; lon: number; timezone: string; source?: string; }
export interface PendingAction { searchId?:string; candidateId?:string; private?:boolean; id: string; kind: 'add'|'change'|'cancel'|'recovery'; journeyId: string|null; status: string; expiresAt: number; notice: string; candidate: Journey|null; before: {from:string;to:string;departure:string;arrival:string;totalCents:number|null}|null; }
export interface Recovery { id:string; journeyId:string; searchId:string; alternative:Journey; state:string; observedAt:string; expiresAt:number; incrementalCostCents:number|null; costBasis:string; automatic:boolean; arrivalDifferenceMinutes?:number; }
export type AgentToolResult = {type:'routes'; search:SearchResult; changeJourneyId?:string|null}|{type:'journeys';journeys:Journey[]}|{type:'document';url:string;label:string}|{type:'recovery';recovery:Recovery[]}|{type:'weather';source:string;fetchedAt:string;cache:string;periods:{name:string;shortForecast:string;temperature:number;temperatureUnit:string}[];alerts:{id:string;headline:string}[]}|{type:'status';journey:Journey;source:string;fetchedAt:string};
