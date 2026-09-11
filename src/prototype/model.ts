export const stations = {
  NYP: { city: 'New York', name: 'Moynihan Train Hall', coords: [-73.9967, 40.7506] as [number, number] },
  WAS: { city: 'Washington, D.C.', name: 'Union Station', coords: [-77.0064, 38.8971] as [number, number] },
  PHL: { city: 'Philadelphia', name: '30th Street Station', coords: [-75.182, 39.9567] as [number, number] },
  BOS: { city: 'Boston', name: 'South Station', coords: [-71.0552, 42.3522] as [number, number] },
  BAL: { city: 'Baltimore', name: 'Penn Station', coords: [-76.6157, 39.3074] as [number, number] },
};
export type StationCode = keyof typeof stations;
export type Trip = { id: string; from: StationCode; to: StationCode; date: string; departure: string; duration: number; passengers: number; service: string; price: number; status: 'upcoming' | 'cancelled'; disrupted: boolean; alternative: number | null; backupBase?: { departure: string; duration: number; price: number; service: string; date: string } };
export type Snapshot = { at: string; label: string; trips: Trip[] };
export type DemoState = { trips: Trip[]; snapshots: Snapshot[]; automatic: boolean; events: string[] };
export const initialTrips: Trip[] = [
  { id: 'WL-260918', from: 'NYP', to: 'WAS', date: '2026-09-18', departure: '09:00', duration: 175, passengers: 1, service: 'Northeast Express', price: 89, status: 'upcoming', disrupted: false, alternative: null },
  { id: 'WL-260925', from: 'NYP', to: 'BOS', date: '2026-09-25', departure: '10:30', duration: 220, passengers: 1, service: 'Coastal Regional', price: 74, status: 'upcoming', disrupted: false, alternative: null },
];
export const initialState: DemoState = { trips: initialTrips, snapshots: [], automatic: true, events: ['Your sample journeys are ready.'] };
export const storageKey = 'wayline-design-prototype-v1';
export function addDays(date: string, days: number) { const value = new Date(date + "T12:00:00Z"); value.setUTCDate(value.getUTCDate()+days); return value.toISOString().slice(0,10); }
export function timeAt(time: string, minutes = 0) { const [h, m] = time.split(':').map(Number); const total = h * 60 + m + minutes; return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
export function dateLabel(date: string, long = false) { return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: long ? 'long' : 'short', day: 'numeric', ...(long ? { year: 'numeric' as const } : { weekday: 'short' as const }) }); }
export function durationLabel(minutes: number) { return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
export function alternatives(current: Trip) { const trip = current.backupBase || current; return [
  { id: 0, name: 'Next express', mode: 'train', delay: 30, duration: trip.duration + 5, price: trip.price + 12, note: 'Same stations · no transfers', badge: 'Best fit' },
  { id: 1, name: 'Regional rail', mode: 'train', delay: 45, duration: trip.duration + 40, price: Math.max(29, trip.price - 24), note: 'Same stations · extra travel time', badge: 'Lower fare' },
  { id: 2, name: 'Intercity coach', mode: 'bus', delay: 60, duration: trip.duration + 100, price: Math.max(19, trip.price - 42), note: 'Station pickup · extra travel time', badge: 'Another way' },
]; }
export function withTrips(state: DemoState, trips: Trip[], label: string): DemoState { return { ...state, trips, snapshots: [{ at: new Date().toISOString(), label, trips: structuredClone(state.trips) }, ...state.snapshots].slice(0, 15), events: [label, ...state.events].slice(0, 20) }; }
export function chooseBackup(state: DemoState, id: string, choice: number): DemoState { const trip = state.trips.find(t => t.id === id); if (!trip || trip.status === 'cancelled' || trip.alternative !== null) return state; const option = alternatives(trip).find(a => a.id === choice); if (!option) return state; return withTrips(state, state.trips.map(t => t.id === id ? { ...t, backupBase: { departure: t.departure, duration: t.duration, price: t.price, service: t.service, date: t.date }, departure: timeAt(t.departure, option.delay), date: addDays(t.date, Math.floor((Number(t.departure.slice(0, 2))*60 + Number(t.departure.slice(3)) + option.delay)/1440)), duration: option.duration, service: option.name, price: option.price, disrupted: false, alternative: choice } : t), `Backup applied: ${option.name} for ${stations[trip.to].city}.`); }
export function simulateDisruption(state: DemoState, id: string): DemoState { const trip = state.trips.find(t => t.id === id); if (!trip || trip.status === 'cancelled' || trip.alternative !== null || trip.disrupted) return state; const changed = withTrips(state, state.trips.map(t => t.id === id ? { ...t, disrupted: true } : t), 'Demo disruption detected: original service cancelled.'); return state.automatic ? chooseBackup(changed, id, 0) : changed; }
export function restoreSnapshot(state: DemoState, index: number): DemoState { const snapshot = state.snapshots[index]; return snapshot ? withTrips(state, structuredClone(snapshot.trips), `Restored journey snapshot: ${snapshot.label}`) : state; }
export function validTrip(value: unknown): value is Trip { if (!value || typeof value !== 'object') return false; const t = value as Trip; return typeof t.id === 'string' && Object.hasOwn(stations, t.from) && Object.hasOwn(stations, t.to) && t.from !== t.to && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number.isFinite(Date.parse(t.date)) && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.departure) && Number.isFinite(t.duration) && t.duration > 0 && Number.isInteger(t.passengers) && t.passengers > 0 && t.passengers <= 8 && typeof t.service === 'string' && Number.isFinite(t.price) && t.price >= 0 && ['upcoming', 'cancelled'].includes(t.status) && typeof t.disrupted === 'boolean' && (t.alternative === null || [0, 1, 2].includes(t.alternative)); }
export function loadDemo(): DemoState { try { const data = JSON.parse(localStorage.getItem(storageKey) || 'null'); if (data && Array.isArray(data.trips) && data.trips.every(validTrip) && typeof data.automatic === 'boolean' && Array.isArray(data.events) && data.events.every((e: unknown) => typeof e === 'string') && Array.isArray(data.snapshots) && data.snapshots.every((s: Snapshot) => typeof s.at === 'string' && typeof s.label === 'string' && Array.isArray(s.trips) && s.trips.every(validTrip))) return data; } catch { /* A damaged local draft must not prevent opening the prototype. */ } return structuredClone(initialState); }

