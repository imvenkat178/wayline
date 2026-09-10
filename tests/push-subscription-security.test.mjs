import test from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns";
import { randomBytes } from "node:crypto";
import { validateRecord } from "../server/records.mjs";
import { DomainError } from "../server/domain/journeys.mjs";
import {
  isForbiddenIPv4,
  isForbiddenIPv6,
  isForbiddenAddress,
  isAllowedPushHost,
} from "../server/netGuard.mjs";
import { safeLookup } from "../server/push.mjs";

// A real Web Push subscription's keys are RFC 8291-shaped: p256dh a 65-byte uncompressed EC
// point (leading 0x04), auth 16 random bytes, both base64url.
function validKeys() {
  return {
    p256dh: Buffer.concat([Buffer.from([0x04]), randomBytes(64)]).toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

test("isForbiddenIPv4 rejects loopback, private, link-local (incl. cloud metadata), CGNAT and reserved ranges", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.5.5",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata, e.g. AWS/GCP/Azure instance metadata service
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
  ])
    assert.equal(isForbiddenIPv4(ip), true, ip);
});

test("isForbiddenIPv4 allows ordinary public addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"])
    assert.equal(isForbiddenIPv4(ip), false, ip);
});

test("isForbiddenIPv6 rejects loopback, unique-local, link-local, multicast and mapped-private-IPv4", () => {
  for (const ip of [
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
  ])
    assert.equal(isForbiddenIPv6(ip), true, ip);
});

test("isForbiddenIPv6 allows an ordinary public address", () => {
  assert.equal(isForbiddenIPv6("2606:4700:4700::1111"), false);
});

test("isForbiddenAddress dispatches by family and fails closed on unrecognizable input", () => {
  assert.equal(isForbiddenAddress("127.0.0.1"), true);
  assert.equal(isForbiddenAddress("8.8.8.8"), false);
  assert.equal(isForbiddenAddress("::1"), true);
  assert.equal(isForbiddenAddress("not-an-ip"), true);
});

test("isAllowedPushHost accepts only the maintained browser push-service hosts", () => {
  assert.equal(isAllowedPushHost("fcm.googleapis.com"), true);
  assert.equal(isAllowedPushHost("updates.push.services.mozilla.com"), true);
  assert.equal(isAllowedPushHost("web.push.apple.com"), true);
  assert.equal(isAllowedPushHost("wns2-abc.notify.windows.com"), true);
  assert.equal(isAllowedPushHost("evil.com"), false);
  // A hostname that merely ends with an allowed suffix as a sibling label, not a real subdomain
  // of it, must not slip through a naive endsWith check.
  assert.equal(isAllowedPushHost("fcm.googleapis.com.evil.com"), false);
  assert.equal(isAllowedPushHost("notfcm.googleapis.com"), false);
});

test("validateRecord('push-subscription', ...) reproduces and closes the review's exact repro (R03)", () => {
  assert.throws(
    () =>
      validateRecord("push-subscription", {
        endpoint: "https://127.0.0.1:9443/review-only",
        keys: validKeys(),
      }),
    DomainError,
  );
});

test("validateRecord('push-subscription', ...) rejects non-HTTPS, credentialed URLs, and unapproved ports", () => {
  const keys = validKeys();
  assert.throws(() =>
    validateRecord("push-subscription", { endpoint: "http://fcm.googleapis.com/x", keys }),
  );
  assert.throws(() =>
    validateRecord("push-subscription", {
      endpoint: "https://user:pass@fcm.googleapis.com/x",
      keys,
    }),
  );
  assert.throws(() =>
    validateRecord("push-subscription", { endpoint: "https://fcm.googleapis.com:8443/x", keys }),
  );
});

test("validateRecord('push-subscription', ...) rejects a host outside the maintained allowlist", () => {
  assert.throws(() =>
    validateRecord("push-subscription", {
      endpoint: "https://attacker.example/collect",
      keys: validKeys(),
    }),
  );
});

test("validateRecord('push-subscription', ...) rejects malformed keys (wrong length, wrong alphabet, missing uncompressed-point marker)", () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/x";
  const auth = randomBytes(16).toString("base64url");
  assert.throws(() =>
    validateRecord("push-subscription", { endpoint, keys: { p256dh: "p1", auth: "a1" } }),
  );
  // Right length, wrong leading byte -- not a real uncompressed EC point.
  const wrongMarker = Buffer.concat([Buffer.from([0x02]), randomBytes(64)]).toString("base64url");
  assert.throws(() =>
    validateRecord("push-subscription", { endpoint, keys: { p256dh: wrongMarker, auth } }),
  );
  // Wrong length entirely.
  const wrongLength = randomBytes(64).toString("base64url");
  assert.throws(() =>
    validateRecord("push-subscription", { endpoint, keys: { p256dh: wrongLength, auth } }),
  );
  // Invalid base64url alphabet.
  assert.throws(() =>
    validateRecord("push-subscription", {
      endpoint,
      keys: { p256dh: validKeys().p256dh, auth: "not!base64url" },
    }),
  );
});

test("validateRecord('push-subscription', ...) accepts a well-formed subscription to an allowlisted push service", () => {
  const v = validateRecord("push-subscription", {
    endpoint: "https://fcm.googleapis.com/fcm/send/real-looking-id",
    keys: validKeys(),
    userAgent: "Mozilla/5.0 test",
  });
  assert.equal(v.endpoint, "https://fcm.googleapis.com/fcm/send/real-looking-id");
});

test("safeLookup rejects a hostname that resolves to a loopback address (e.g. localhost)", async () => {
  await new Promise((resolve, reject) => {
    safeLookup("localhost", {}, (err) => {
      try {
        assert.ok(err, "expected localhost's loopback resolution to be rejected");
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
});

test("safeLookup passes through a mocked resolution to a public address", async (t) => {
  t.mock.method(dns, "lookup", (hostname, options, callback) => {
    if (typeof options === "function") callback = options;
    callback(null, [{ address: "8.8.8.8", family: 4 }]);
  });
  await new Promise((resolve, reject) => {
    safeLookup("fcm.googleapis.com", {}, (err, address, family) => {
      try {
        assert.equal(err, null);
        assert.equal(address, "8.8.8.8");
        assert.equal(family, 4);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
});

test("safeLookup rejects a mocked resolution to a private address, even for an otherwise-allowlisted host (DNS rebinding)", async (t) => {
  t.mock.method(dns, "lookup", (hostname, options, callback) => {
    if (typeof options === "function") callback = options;
    callback(null, [{ address: "169.254.169.254", family: 4 }]);
  });
  await new Promise((resolve, reject) => {
    safeLookup("fcm.googleapis.com", {}, (err) => {
      try {
        assert.ok(err, "expected a private-address resolution to be rejected");
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
});
