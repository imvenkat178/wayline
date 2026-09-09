import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

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
if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
