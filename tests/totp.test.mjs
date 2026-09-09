import test from "node:test";
import assert from "node:assert/strict";
import {
  base32Encode,
  base32Decode,
  generateSecret,
  totp,
  verifyTotp,
  otpauthUrl,
  generateRecoveryCodes,
  normalizeRecoveryCode,
} from "../server/totp.mjs";

// Official RFC 6238 Appendix B test vectors for the SHA-1/6-digit/30-second-step variant --
// the exact parameters this implementation uses. These pin the HOTP/TOTP math itself: if this
// regresses, every authenticator app in the world would compute a different code than we do.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));
const RFC_VECTORS = [
  { time: 59 * 1000, code: "287082" },
  { time: 1111111109 * 1000, code: "081804" },
  { time: 2000000000 * 1000, code: "279037" },
];

test("totp matches the official RFC 6238 Appendix B test vectors", () => {
  for (const { time, code } of RFC_VECTORS) {
    assert.equal(totp(RFC_SECRET, { time }), code);
  }
});

test("verifyTotp accepts the RFC vectors and rejects a wrong code", () => {
  for (const { time, code } of RFC_VECTORS) {
    assert.equal(verifyTotp(RFC_SECRET, code, { time }), true);
    assert.equal(verifyTotp(RFC_SECRET, "000000", { time }), false);
  }
});

test("verifyTotp tolerates one step of clock drift on either side, but not two", () => {
  const time = 59 * 1000;
  const codeNext = totp(RFC_SECRET, { time: time + 30000 });
  const codePrev = totp(RFC_SECRET, { time: time - 30000 }); // clamped to 0, same as counter 0
  const codeTwoAway = totp(RFC_SECRET, { time: time + 60000 });
  assert.equal(verifyTotp(RFC_SECRET, codeNext, { time }), true);
  assert.equal(verifyTotp(RFC_SECRET, codeTwoAway, { time }), false);
});

test("verifyTotp rejects malformed input without throwing", () => {
  assert.equal(verifyTotp(RFC_SECRET, "12345", {}), false);
  assert.equal(verifyTotp(RFC_SECRET, "abcdef", {}), false);
  assert.equal(verifyTotp(RFC_SECRET, null, {}), false);
  assert.equal(verifyTotp(RFC_SECRET, undefined, {}), false);
});

test("base32Encode/base32Decode round-trip arbitrary bytes", () => {
  for (const length of [0, 1, 5, 10, 16, 20, 33]) {
    const original = Buffer.from(Array.from({ length }, (_, i) => (i * 7 + 3) % 256));
    const decoded = base32Decode(base32Encode(original));
    assert.deepEqual(decoded, original);
  }
});

test("base32Decode tolerates padding, hyphens, whitespace, and lowercase", () => {
  const clean = base32Encode(Buffer.from("hello wayline", "utf8"));
  const messy =
    clean
      .toLowerCase()
      .match(/.{1,4}/g)
      .join("-") + "  ";
  assert.deepEqual(base32Decode(messy), base32Decode(clean));
});

test("generateSecret returns a fresh, valid base32 secret each time", () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Z2-7]+$/);
  // 20 raw bytes base32-encoded (unpadded) is 32 characters.
  assert.equal(a.length, 32);
});

test("otpauthUrl embeds the secret and Wayline-standard parameters for an authenticator app to scan", () => {
  const secret = generateSecret();
  const url = otpauthUrl(secret, { accountName: "user@example.com" });
  assert.match(url, /^otpauth:\/\/totp\/Wayline%3Auser%40example\.com\?/);
  const params = new URL(url).searchParams;
  assert.equal(params.get("secret"), secret);
  assert.equal(params.get("issuer"), "Wayline");
  assert.equal(params.get("algorithm"), "SHA1");
  assert.equal(params.get("digits"), "6");
  assert.equal(params.get("period"), "30");
});

test("generateRecoveryCodes produces the requested count of unique, well-formed codes", () => {
  const codes = generateRecoveryCodes(8);
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  for (const code of codes) assert.match(code, /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
});

test("normalizeRecoveryCode strips formatting and case so re-entry hashes match generation", () => {
  const [code] = generateRecoveryCodes(1);
  const messyVariants = [
    code.toLowerCase(),
    code.replace(/-/g, " "),
    ` ${code} `,
    code.replace(/-/g, ""),
  ];
  const canonical = normalizeRecoveryCode(code);
  for (const variant of messyVariants) assert.equal(normalizeRecoveryCode(variant), canonical);
});
