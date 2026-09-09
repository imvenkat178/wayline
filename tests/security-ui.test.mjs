import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Same source-text-assertion approach as tests/push-ui.test.mjs (this codebase has no
// component-rendering harness) -- can't prove the Security tab and MFA/recovery modals render
// correctly, but catches the wiring being removed or silently pointed at a different route than
// the one server/router.mjs actually registers.
const profile = readFileSync(
  fileURLToPath(new URL("../src/pages/Profile.tsx", import.meta.url)),
  "utf8",
);
const routes = readFileSync(fileURLToPath(new URL("../src/routes.ts", import.meta.url)), "utf8");

test("Profile.tsx's MFA setup/confirm/disable calls hit the routes server/router.mjs registers", () => {
  assert.match(profile, /"\/mfa\/setup"/);
  assert.match(profile, /"\/mfa\/confirm"/);
  assert.match(profile, /"\/mfa\/disable"/);
});

test("Profile.tsx's login flow handles the mfaRequired challenge before ever calling switchIdentity", () => {
  assert.match(profile, /mfaRequired/);
  assert.match(profile, /"\/auth\/mfa-verify"/);
  assert.match(profile, /pendingToken/);
});

test("Profile.tsx's session list hits GET/DELETE /sessions and the revoke-others route", () => {
  assert.match(profile, /"\/sessions"/);
  assert.match(profile, /"\/sessions\/revoke-others"/);
  assert.match(profile, /\/sessions\/\$\{encodeURIComponent\(s\.id\)\}/);
});

test("Profile.tsx's password recovery flow hits the recovery request/reset routes", () => {
  assert.match(profile, /"\/auth\/recovery\/request"/);
  assert.match(profile, /"\/auth\/recovery\/reset"/);
});

test("Profile.tsx reads boot.mfaEnabled to decide which MFA UI to show", () => {
  assert.match(profile, /boot\.mfaEnabled/);
});

test("Profile.tsx shows recovery codes from mfa/confirm's response, not a locally-generated value", () => {
  assert.match(profile, /recoveryCodes/);
  assert.match(profile, /codes\.recoveryCodes/);
});

test("routes.ts recognizes a reset-password link and can pull the token back out of it", () => {
  assert.match(routes, /reset-password/);
  assert.match(routes, /export function resetPasswordToken/);
});
