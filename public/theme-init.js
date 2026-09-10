// Applies the saved (or system-default) theme before the stylesheet paints, so the page never
// flashes the wrong theme on load. Loaded as a plain same-origin <script src> (not inlined) so it
// runs under the app's CSP, which has no 'unsafe-inline' for script-src; index.html references it
// before the styles.css <link> Vite injects at the end of <head>, so this always runs first.
// Kept deliberately tiny and defensive: localStorage/matchMedia can throw in locked-down embeds,
// and a failure here must never block the app from loading.
(function () {
  try {
    var stored = localStorage.getItem("wayline-theme");
    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
