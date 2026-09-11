// Light/dark theme state. The actual switch happens in CSS (styles.css keys every color off a
// `data-theme` attribute on <html>); this module is just the read/write/persist layer around
// that attribute, shared between the early-boot inline script in index.html (which has to
// duplicate the read logic in plain JS to run before any React code exists) and the in-app
// ThemeToggle control in components/ui.tsx.
export type Theme = "light" | "dark";

const STORAGE_KEY = "wayline-theme";
// Kept in sync with the <meta name="theme-color"> Wayline ships in index.html for each theme, so
// the browser chrome (status bar, task switcher card) matches whichever theme is active.
const META_COLOR: Record<Theme, string> = { dark: "#122e37", light: "#e8f2f5" };

function systemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

/** The theme currently applied to the document (falls back to the system preference). */
export function getTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return readStoredTheme() ?? "light";
}

/** True once the user has explicitly picked a theme, rather than following the system default. */
export function hasExplicitTheme(): boolean {
  return readStoredTheme() !== null;
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", META_COLOR[theme]);
}

/** Sets and persists an explicit theme choice. */
export function setTheme(theme: Theme) {
  applyTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable (private browsing, disabled cookies) -- the theme still applies
    // for this page view, it just won't be remembered on the next one.
  }
}

/** Clears the explicit choice and reverts to following the system preference. */
export function useSystemTheme() {
  applyTheme(systemTheme());
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See setTheme -- non-fatal.
  }
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "light" ? "dark" : "light";
  setTheme(next);
  return next;
}
