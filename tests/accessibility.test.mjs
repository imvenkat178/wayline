import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importTsx } from "./helpers/compileTsx.mjs";

// Phase 9 (accessibility, WCAG 2.2 AA target). This wires axe-core into the test suite for
// automated regression coverage of the app's shared UI primitives (src/components/ui.tsx).
//
// Honest scope, please read before trusting a green run here:
//   - This renders REAL component source (compiled from the actual .tsx file via esbuild, not a
//     hand-copied reimplementation -- see tests/helpers/compileTsx.mjs) to static HTML with
//     react-dom/server, drops it into a jsdom document, and runs axe-core against it.
//   - jsdom has no layout/rendering engine, so axe rules that depend on actual visual layout or
//     computed styles -- color-contrast chief among them -- are NOT meaningfully exercised here.
//     A real-browser run (e.g. Playwright+axe) would be needed for those, and that path was tried
//     for this project and is currently infeasible in this environment: `npx playwright install`
//     fails with a 403 from the network egress allowlist when it tries to download the Chromium
//     binary. So color-contrast, focus-visible-in-practice, and full-page/composed-layout checks
//     still need a real browser and/or human/screen-reader review -- this file does not claim to
//     replace that.
//   - Coverage here is limited to the primitives actually rendered below (Button, Badge, Notice,
//     Empty, Field, Toggle, Modal, Section), not every page or every composed screen in the app.
//     It catches real structural/ARIA regressions (missing labels, bad roles, missing document
//     language/title, invalid ARIA attributes) in these building blocks going forward.
//
// Two implementation notes learned the hard way while writing this file:
//   1. axe-core's own module-scope setup code touches `window`/`document` at import time, and
//      internally caches that `window` reference in closures it keeps using afterwards (e.g. its
//      `instanceof window.Node` checks) -- so a *fresh* jsdom Document created after that import
//      fails those checks with a confusing "axe.run arguments are invalid" error, even though the
//      document itself is perfectly valid. The fix is to create exactly ONE jsdom window/document
//      for the whole file, set `global.window`/`global.document` to it BEFORE the dynamic
//      `await import("axe-core")` (import hoisting would otherwise run axe-core's setup before
//      any of this module's own statements), and then reuse that same document for every test,
//      resetting `document.body.innerHTML` between cases rather than constructing a new JSDOM.
//   2. Components must be rendered via `createElement(Component, props)` and handed to
//      `renderToStaticMarkup`, never invoked directly as a plain function call
//      (`Component(props)`). Calling a component function directly runs its body -- including
//      any hooks (useRef, useEffect, useState) -- with no active React dispatcher, which throws
//      for any component that uses hooks (caught here via Modal, which uses useRef/useEffect).

let ui;
let axeCore;

test.before(async () => {
  ui = await importTsx(join(process.cwd(), "src/components/ui.tsx"));

  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(
    `<!doctype html><html lang="en"><head><title>Accessibility test harness</title></head><body></body></html>`,
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  axeCore = (await import("axe-core")).default;
});

async function checkAxe(element) {
  const html = renderToStaticMarkup(element);
  globalThis.document.body.innerHTML = html;
  const results = await axeCore.run(globalThis.document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
  });
  return { html, results };
}

function violationSummary(results) {
  return results.violations
    .map((v) => `${v.id}: ${v.nodes.length} node(s) -- ${v.help}`)
    .join("\n");
}

test("Button (default) has no axe violations", async () => {
  const { results } = await checkAxe(
    createElement(ui.Button, { children: "Save preferences", kind: "primary" }),
  );
  assert.equal(results.violations.length, 0, violationSummary(results));
});

test("Button (icon-only, with title) has no axe violations", async () => {
  // Icon-only buttons rely on the title->aria-label wiring in Button() for a real accessible
  // name -- this is the specific case the Phase 9 research pass confirmed is already solid.
  const { html, results } = await checkAxe(
    createElement(ui.Button, { icon: "close", title: "Close dialog", kind: "icon-only" }),
  );
  assert.equal(results.violations.length, 0, violationSummary(results));
  // Belt-and-suspenders: assert the accessible name actually made it into the markup, not just
  // that axe didn't flag it (axe's button-name rule would catch a missing name either way).
  assert.match(html, /aria-label="Close dialog"/);
});

test("Badge has no axe violations", async () => {
  const { results } = await checkAxe(
    createElement(ui.Badge, { children: "Resolved", tone: "mint" }),
  );
  assert.equal(results.violations.length, 0, violationSummary(results));
});

test("Notice (info) has no axe violations", async () => {
  const { results } = await checkAxe(
    createElement(ui.Notice, { children: "Heads up.", tone: "info" }),
  );
  assert.equal(results.violations.length, 0, violationSummary(results));
});

test("Notice (error, role=alert) has no axe violations", async () => {
  const { html, results } = await checkAxe(
    createElement(ui.Notice, { children: "Something failed.", tone: "error" }),
  );
  assert.equal(results.violations.length, 0, violationSummary(results));
  assert.match(html, /role="alert"/);
});

test("Empty state has no axe violations", async () => {
  const { results } = await checkAxe(
    createElement(ui.Empty, {
      icon: "route",
      title: "No journeys yet",
      children: "Plan your first trip.",
    }),
  );
  assert.equal(results.violations.length, 0, violationSummary(results));
});

test("Field (labeled input) has no axe violations", async () => {
  const { results } = await checkAxe(
    createElement(ui.Field, {
      label: "Departure station",
      hint: "Start typing to search",
      children: createElement("input", { type: "text" }),
    }),
  );
  assert.equal(results.violations.length, 0, violationSummary(results));
});

test("Toggle (labeled switch) has no axe violations", async () => {
  const { results } = await checkAxe(
    createElement(ui.Toggle, {
      label: "Notifications",
      description: "Get alerted about delays.",
      checked: true,
      onChange: () => {},
    }),
  );
  assert.equal(results.violations.length, 0, violationSummary(results));
});

test("Section with a heading has no axe violations", async () => {
  const { results } = await checkAxe(
    createElement(ui.Section, {
      title: "Upcoming departures",
      children: createElement(ui.Empty, { title: "Nothing yet" }),
    }),
  );
  assert.equal(results.violations.length, 0, violationSummary(results));
});

test("Modal dialog content has no axe violations", async () => {
  // Modal itself calls showModal()/useEffect on mount, which needs a real browser DOM event loop
  // -- rendered here as static markup instead, which still lets axe check the dialog's own
  // structure (aria-label, the close button's accessible name, heading) even though the
  // open/focus-trap *behavior* (already using native <dialog>.showModal(), which handles focus
  // trapping and Escape-to-close for free) isn't exercised by a static-markup render.
  const { results } = await checkAxe(
    createElement(ui.Modal, {
      title: "Edit alert",
      onClose: () => {},
      children: createElement(ui.Field, {
        label: "Alert name",
        children: createElement("input", { type: "text" }),
      }),
    }),
  );
  assert.equal(results.violations.length, 0, violationSummary(results));
});

test("a composed fragment (several primitives together, as a page would use them) has no axe violations", async () => {
  const { results } = await checkAxe(
    createElement(ui.Section, {
      title: "Trip alerts",
      action: createElement(ui.Button, { icon: "plus", title: "Add alert", kind: "icon-only" }),
      children: [
        createElement(ui.Notice, {
          key: "n",
          children: "Delays possible this evening.",
          tone: "warn",
        }),
        createElement(ui.Badge, { key: "b", children: "3 active", tone: "" }),
        createElement(ui.Toggle, {
          key: "t",
          label: "Push notifications",
          checked: false,
          onChange: () => {},
        }),
      ],
    }),
  );
  assert.equal(results.violations.length, 0, violationSummary(results));
});
