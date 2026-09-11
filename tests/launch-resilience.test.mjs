import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { createElement, lazy, Suspense, act } from "react";
import { createRoot } from "react-dom/client";
import { importTsx } from "./helpers/compileTsx.mjs";
import { readyRegistration, shellReady } from "../src/serviceWorker.ts";

function useNavigator(t, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value, configurable: true });
  t.after(() => descriptor ? Object.defineProperty(globalThis, "navigator", descriptor) : delete globalThis.navigator);
}

test("a never-ready service worker cannot hang notification setup or offline readiness", async (t) => {
  useNavigator(t, { serviceWorker: { ready: new Promise(() => {}) } });
  assert.equal(await readyRegistration(15), null);
  assert.equal(await shellReady(15), false);
});

test("service worker readiness handles missing support, rejection and successful activation", async (t) => {
  useNavigator(t, {});
  assert.equal(await readyRegistration(15), null);
  navigator.serviceWorker = { ready: Promise.reject(new Error("blocked")) };
  assert.equal(await readyRegistration(15), null);
  const registration = { active: { postMessage: (_message, ports) => ports[0].postMessage({ ready: true }) } };
  navigator.serviceWorker = { ready: Promise.resolve(registration) };
  assert.equal(await readyRegistration(15), registration);
  assert.equal(await shellReady(100), true);
});

test("a failed lazy import keeps navigation and offline recovery usable; navigating resets the section", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  const globals = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"];
  const descriptors = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { default: Boundary } = await importTsx(join(process.cwd(), "src/components/SectionErrorBoundary.tsx"));
  const root = createRoot(document.getElementById("root"), { onCaughtError: () => {} });
  t.after(async () => {
    await act(() => root.unmount());
    dom.window.close();
    globals.forEach((key, i) => descriptors[i] ? Object.defineProperty(globalThis, key, descriptors[i]) : delete globalThis[key]);
  });
  const FailedPage = lazy(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
  let offlineClicks = 0;
  const render = (key, child) => createElement("div", null,
    createElement("nav", null, "My journeys"),
    createElement(Boundary, { key, onOffline: () => offlineClicks++ },
      createElement(Suspense, { fallback: "Loading" }, child)));
  await act(async () => { root.render(render("profile", createElement(FailedPage))); });
  assert.equal(document.querySelector("nav").textContent, "My journeys");
  assert.match(document.body.textContent, /get you back on track/);
  const offlineButton = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Open offline packs"));
  assert.ok(offlineButton);
  await act(() => offlineButton.click());
  assert.equal(offlineClicks, 1);
  await act(() => root.render(render("trips", createElement("h1", null, "Saved journeys"))));
  assert.match(document.body.textContent, /Saved journeys/);
  assert.doesNotMatch(document.body.textContent, /get you back on track/);
});
