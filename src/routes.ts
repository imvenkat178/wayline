import type { Page } from "./types";

// The app's known top-level pages, in sidebar order, paired with their icon name.
export const nav: [Page, string][] = [['plan', 'route'], ['trips', 'clock'], ['assistant', 'spark'], ['journey', 'shield'], ['wallet', 'ticket'], ['inbox', 'bell'], ['commute', 'refresh'], ['profile', 'user'], ['lab', 'globe']];

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
  // A password-reset link (server/router.mjs's recovery/request builds `#reset-password?token=...`)
  // routes to the Profile page, where resetPasswordToken() below picks the token back out so the
  // Security tab can open its reset form automatically.
  if (hash.startsWith("reset-password"))
    return { page: "profile", offline: false, recognized: true };
  if (hash === "watch" || nav.some(([p]) => p === hash))
    return { page: hash as Page, offline: false, recognized: true };
  return { page: "plan", offline: false, recognized: false };
}
// Extracts the token from a `reset-password?token=...` hash, or null if the hash isn't one --
// used once, on Profile's mount, to auto-open the reset-password form from a real link.
export function resetPasswordToken(hash: string): string | null {
  if (!hash.startsWith("reset-password")) return null;
  return new URLSearchParams(hash.split("?")[1] ?? "").get("token");
}
