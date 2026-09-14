import type { TravelerActionId } from './travelerActions';
import type { AgentResult, Journey, Place, Preferences } from './types';

export interface FlightPassenger { id: string; type: 'adult' | 'child'; age?: number; personal: number; cabin: number; checked: number }
export interface FlightMoney { amount: number; currency: string; scale: number }
export interface FlightCandidate {
  id: string; live: boolean; expiresAt: string; durationMinutes: number; transfers: number;
  services: { id: string; operator: string; serviceNumber: string; departure: string; arrival: string;
    origin: { name: string; iata?: string; timezone: string }; destination: { name: string; iata?: string; timezone: string } }[];
  pricing: { total: FlightMoney | null; complete: boolean; unknownComponents: string[] };
  limitation?: string; conditions: { refund: string; change: string; protection: string };
  components: { id: string; label: string; money: FlightMoney | null; includedIn?: string; kind: string }[];
  connections: { status: string; reason: string; slackMinutes?: number | null }[];
  ticketGroups: { id: string; serviceIds: string[]; passengerIds: string[] }[];
}
export interface FlightReview { id: string; state: string; notice: string; candidate: FlightCandidate | null; expiresAt: number; draftVersion: number }
export interface FlightSearchProgress { id: string; state: string; reason?: string; queries: { state: string; origin: string; destination: string; date: string }[] }

export interface TripConstraints {
  from: string | Place; to: string | Place; departure: string; deadline: string | null;
  travelers: number; bags: number; mode: 'sample' | 'provider' | 'flights'; timezone: string;
  originAirports?:string[]; destinationAirports?:string[]; flexibleDates?:string[];
  passengers?: FlightPassenger[]; flightWindowHours?: number; returnDate?: string | null; additionalFlights?: {from:string;to:string;departure:string}[]; resolvedAirports?: (Place & {kind:'airport';country:'US';iata:string})[];
  avoidOvernight: boolean; preferences: Preferences;
}
export interface WorkspaceCommand {
  op: TravelerActionId;
  patch?: Partial<Omit<TripConstraints, 'timezone' | 'preferences'>> & { preferences?: Partial<Preferences> };
  searchId?: string; setId?: string; optionIds?: string[]; legId?: string; replacementMode?: string;
  locked?: boolean; name?: string; scenarioId?: string;
}
export interface OptionReference { setId: string; optionId: string }
export interface ChangeSummary { operation: string; changes: { label: string; before: string | number | boolean; after: string | number | boolean }[] }
export interface TripDraft {
  id: string; version: number; constraints: TripConstraints;
  selected: (OptionReference & { journey: Journey; flight?: FlightCandidate }) | null;
  activeShoppingId?: string | null; activeSetId: string | null; comparison: OptionReference[];
  locks: { key: string; legId: string; service: string; mode: string; ticketGroupId?: string }[];
  undoIds: string[]; scenarioIds: string[]; lastChange: ChangeSummary | null;
}
export interface WorkspaceOption { id: string; journey: Journey; flight?: FlightCandidate; complete: boolean; unknowns: string[]; connectionMarginMinutes: number | null; labels: string[] }
export interface CandidateSet {
  id: string; kind?: "flights"; options: WorkspaceOption[]; constraints: TripConstraints; searchId: string;
  source: string; fetchedAt: string; expiresAt: number; warning: string | null;
  excluded: { name: string; reason: string }[]; reliabilityNotice: string;
}
export interface ConversationSummary { id: string; title: string; updatedAt: string; journeyId: string | null }
export interface WorkspaceSnapshot {
  conversation: ConversationSummary & { pending: { until: number } | null; expiresAt: number };
  draft: TripDraft; sets: CandidateSet[];
  scenarios: { id: string; name: string; departure: string; summary: ChangeSummary['changes'] }[];
  shoppingSearches: FlightSearchProgress[]; savedComparison: { id: string; priceValidUntil: string } | null;
  messages: (AgentResult & { id: string; status: string; protectedPanel?: TravelerActionId; documents?: {label:string;url:string}[]; workflowEvidence?: {label:string;value:string;source:string;url?:string|null;observedAt:string}[]; shoppingSearchId?: string; flightReview?: FlightReview; retryCommand?: WorkspaceCommand; setIds?: string[]; change?: ChangeSummary; comparison?: OptionReference[] })[];
  execution?: { id: string; state: string; input: string; error?: string; inference?: { source: string; model?: string; reason?: string }; events: { sequence: number; type: string; message: string }[] } | null;
  journey: Journey | null;
}
