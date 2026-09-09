import test from "node:test";
import assert from "node:assert/strict";
import {
  t,
  formatDate,
  formatDateTime,
  formatNumber,
  formatCurrencyCents,
  resources,
  SUPPORTED_LOCALES,
  FULL_UI_LOCALES,
  localeTags,
} from "../src/i18n.ts";

// Phase 7 (roadmap features 93/94, "Multilingual support" and "Visitor mode"): the pure lookup
// and Intl-based formatting logic behind every t()/formatDate()/formatCurrencyCents() call the
// frontend makes (via src/useT.ts). These are the assertions the browser-rendered pages
// themselves can't easily be regression-tested for in this Node-based suite, so this exercises
// the engine directly instead.

test("t() returns the requested locale's translation when one exists", () => {
  assert.equal(t("es", "nav.plan"), "Planificar viaje");
  assert.equal(t("hi", "nav.plan"), "यात्रा की योजना");
});

test("t() falls back to English when the requested locale has no entry for that key", () => {
  // hi intentionally only covers nav.*/phrasebook.* -- everything else falls back to English.
  assert.equal(resources.hi["planner.heading"], undefined);
  assert.equal(t("hi", "planner.heading"), t("en", "planner.heading"));
});

test("t() falls back to the bare key itself when no locale (including English) has it", () => {
  assert.equal(t("en", "no.such.key"), "no.such.key");
  assert.equal(t("es", "no.such.key"), "no.such.key");
});

test("t() substitutes {var} placeholders from the vars argument", () => {
  assert.equal(t("en", "planner.waysToGetThere", { n: 3 }), "3 ways to get there");
  assert.equal(t("es", "planner.waysToGetThere", { n: 3 }), "3 formas de llegar");
});

test("t() leaves an unmatched placeholder untouched rather than throwing", () => {
  assert.equal(t("en", "planner.travelerStartsIn"), "Traveler {n} starts in");
});

test("every English key referenced by the app resolves to a non-empty string in every declared locale (directly or via fallback)", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of Object.keys(resources.en)) {
      const value = t(locale, key);
      assert.ok(value.length > 0, `${locale}/${key} resolved empty`);
    }
  }
});

test("FULL_UI_LOCALES only lists locales that actually carry the full planner.* catalog", () => {
  for (const locale of FULL_UI_LOCALES) {
    assert.ok(
      resources[locale]["planner.heading"],
      `${locale} is listed as full-UI but is missing planner.heading`,
    );
  }
  // hi is deliberately NOT full-UI yet -- this is the assertion that would fail the day someone
  // adds hi to FULL_UI_LOCALES without actually translating the planner catalog for it.
  assert.ok(!FULL_UI_LOCALES.includes("hi"));
});

test("formatCurrencyCents formats real amounts per-locale and returns null for a missing fare", () => {
  // es maps to es-US (Spanish as spoken by US residents, matching the pre-existing
  // speechSynthesis "es-US" convention this app already used for the phrasebook) -- ICU's
  // es-US currency data actually renders USD identically to en-US, which is correct behavior
  // for this app's US-based audience, not a locale-tagging bug. hi maps to hi-IN, which uses a
  // real, different digit-grouping convention (lakhs) that becomes visible on a larger amount.
  assert.equal(formatCurrencyCents("en", 8500), "$85.00");
  assert.equal(formatCurrencyCents("es", 8500), "$85.00");
  assert.notEqual(formatCurrencyCents("en", 12345650), formatCurrencyCents("hi", 12345650));
  assert.equal(formatCurrencyCents("en", null), null);
  assert.equal(formatCurrencyCents("en", undefined), null);
});

test("formatDate and formatDateTime are locale-tagged (not hardcoded to en-US) and timezone-aware", () => {
  const iso = "2026-03-15T18:30:00Z";
  const enDate = formatDate("en", iso, { month: "short", day: "numeric" });
  const esDate = formatDate("es", iso, { month: "short", day: "numeric" });
  assert.equal(enDate, "Mar 15");
  assert.equal(esDate, "15 mar");
  const withZone = formatDateTime("en", iso, "America/Los_Angeles");
  const utc = formatDateTime("en", iso, "UTC");
  assert.notEqual(withZone, utc); // same instant, different rendered local time per zone
});

test("formatNumber is locale-tagged for grouping/decimal conventions", () => {
  assert.equal(formatNumber("en", 1234.5), "1,234.5");
  // hi-IN groups digits in twos after the first three (lakh-style: "1,23,456.5"), a real,
  // visible difference from en-US's "123,456.5" -- the clearest proof formatNumber is actually
  // locale-tagged and not silently defaulting to en-US regardless of the locale argument.
  assert.equal(formatNumber("en", 123456.5), "123,456.5");
  assert.equal(formatNumber("hi", 123456.5), "1,23,456.5");
});

test("localeTags maps every supported locale to a real BCP 47 tag Intl accepts", () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.doesNotThrow(() => new Intl.NumberFormat(localeTags[locale]));
  }
});
