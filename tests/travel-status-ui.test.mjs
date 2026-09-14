import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { importTsx } from "./helpers/compileTsx.mjs";

test("service panel checks connections, updates after recovery, and refreshes on browser wake", async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const keys = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"];
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let checking = false, connected = false;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, method: options.method });
    if (options.method === "POST") checking = true;
    return Response.json({
      services: [{ name: "Boston routing", status: connected ? "connected" : "unavailable", lastSuccess: "2026-09-11T19:05:00Z", ageSeconds: 26570, reason: connected ? undefined : "ROUTING_UNAVAILABLE" }],
      backup: { status: "ready" }, checking,
    });
  });
  const { ServiceStatus } = await importTsx(join(process.cwd(), "src/components/ServiceStatus.tsx"));
  const root = createRoot(document.getElementById("root"));
  t.after(async () => {
    await act(() => root.unmount()); dom.window.close();
    keys.forEach((key, i) => descriptors[i] ? Object.defineProperty(globalThis, key, descriptors[i]) : delete globalThis[key]);
  });
  await act(async () => root.render(createElement(ServiceStatus)));
  assert.match(document.body.textContent, /local router could not be reached/);
  assert.match(document.body.textContent, /7 hr ago/);
  const button = document.querySelector("button");
  await act(async () => button.click());
  assert.deepEqual(calls.at(-1), { url: "/api/travel/check", method: "POST" });
  assert.equal(button.disabled, true);
  assert.match(document.body.textContent, /Checking travel services/);
  checking = false; connected = true;
  await act(async () => window.dispatchEvent(new window.Event("focus")));
  assert.equal(button.disabled, false);
  assert.match(document.querySelector(".service-state").textContent, /^connected$/);
  assert.doesNotMatch(document.body.textContent, /could not be reached/);
  await act(async () => window.dispatchEvent(new window.Event("online")));
  assert.equal(calls.at(-1).url, "/api/travel/health");
});
