import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type {
  Bootstrap,
  Page,
  Journey,
  SearchResult,
  SearchInput,
  Preferences,
  ParsedRequest,
} from "./types";
export interface AppContextValue {
  boot: Bootstrap;
  setBoot: Dispatch<SetStateAction<Bootstrap | null>>;
  page: Page;
  navigate: (p: Page) => void;
  journeys: Journey[];
  refresh: () => Promise<void>;
  active: Journey | null;
  setActive: (j: Journey | null) => void;
  // Applies a login/register response and clears every piece of state that belonged to the
  // previously active identity (guest or another account). Always use this instead of calling
  // setBoot directly for a login/register/switch -- see its implementation in App.tsx.
  switchIdentity: (next: { user: Bootstrap["user"]; csrf: string }) => void;
  result: SearchResult | null;
  setResult: Dispatch<SetStateAction<SearchResult | null>>;
  searchInput: SearchInput;
  setSearchInput: Dispatch<SetStateAction<SearchInput>>;
  notify: (message: string) => void;
  openAgent: (prompt?: string) => void;
  applyParsed: (p: ParsedRequest) => void;
  online: boolean;
}
export const AppContext = createContext<AppContextValue | null>(null);
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("App context missing");
  return ctx;
}
export const defaultPreferences: Preferences = {
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
  pushDetails: false,
  quietStart: "22:00",
  quietEnd: "07:00",
  // R07: this hardcoded fallback only ever shows before a real bootstrap response loads --
  // Profile.tsx suggests the browser's own detected zone as a starting point for an account
  // that hasn't set one explicitly.
  timezone: "America/Los_Angeles",
  historyDays: 90,
  saveHistory: true,
  shareLocation: false,
  autoRecovery: true,
  recoveryLimitCents: 1000,
  emergencyMinutes: 45,
};
