import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./premium.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Registers the app-shell service worker (public/sw.js) so the app can boot offline after a
// prior online visit. Skipped under `vite dev` (import.meta.env.DEV): the dev server serves
// unhashed, frequently-changing modules that a caching SW would fight with, and Vite's own HMR
// already covers that workflow -- this is a production-only concern. Registration failures
// (unsupported browser, insecure context) are swallowed: the app must remain fully usable
// online with no offline support rather than fail to start.
//
// R08: registered immediately, not deferred to the window `load` event. The deferral was
// originally meant to avoid competing with the initial page's own critical-resource fetches,
// but it also means install()'s precache fetches only ever start once this page has *already*
// finished loading everything it needs -- for a browser that closes its only tab shortly after
// that first load, there's no guarantee install() has finished in time. Since install() now
// precaches an explicit, build-generated asset list (scripts/build-sw.mjs) rather than relying
// on opportunistically catching this exact page's own requests, starting it sooner only helps;
// browsers already give same-origin document/script/style requests fetch priority over a new
// service worker's registration fetch, so this isn't expected to visibly compete for bandwidth
// the deferral was written to avoid.
if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}
