import type { Page } from "./types";

// The app's known top-level pages, in sidebar order, paired with their icon name.
export const nav: [Page, string][] = [
  ["plan", "route"],
  ["journey", "shield"],
  ["wallet", "ticket"],
  ["inbox", "bell"],
  ["trips", "clock"],
  ["commute", "refresh"],
  ["profile", "user"],
  ["lab", "globe"],
];

export interface RouteMatch {
  page: Page;
  offline: boolean;
  recognized: boolean;
}

// Resolves a raw URL hash (without the leading "#") to what the app should show. Shared by the
// initial-load deep-link/refresh handler and the popstate (Back/Forward) handler in App.tsx so
// both treat a direct link, a refresh and real browser navigation the same way -- including a
// hash that matches nothing, which previously left the address bar showing a route the app was
// not actually displaying. Kept in its own dependency-free module (no React, no JSX) so it can
// be unit tested directly.
export function resolveHash(hash: string): RouteMatch {
  if (hash === "offline") return { page: "plan", offline: true, recognized: true };
  if (hash === "watch" || nav.some(([p]) => p === hash))
    return { page: hash as Page, offline: false, recognized: true };
  return { page: "plan", offline: false, recognized: false };
}
