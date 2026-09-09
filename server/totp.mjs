import { randomBytes, createHmac } from "node:crypto";

// TOTP (RFC 6238) over HOTP (RFC 4226), SHA-1/6-digit/30-second-step -- the parameters every
// mainstream authenticator app (Google Authenticator, Authy, 1Password, Apple's built-in one,
// etc.) assumes by default, so a user can set this up with whatever app they already have. No
// external account or service is involved: the secret is generated locally and the code is
// verified locally against the current time, exactly like every other TOTP implementation.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// Encodes raw bytes as unpadded RFC 4648 base32 -- the encoding authenticator apps expect for a
// manually-entered or otpauth:// secret.
export function base32Encode(buffer) {
  let bits = 0,
    value = 0,
    output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

// Decodes an RFC 4648 base32 string (padding, hyphens and whitespace tolerated, case-insensitive
// -- the messy real-world variants a user might paste back in) into raw bytes.
export function base32Decode(input) {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// Generates a fresh 20-byte (160-bit) secret -- the length RFC 4226 recommends for HMAC-SHA1 --
// and returns it already base32-encoded, ready to store, display, or embed in an otpauth:// URI.
export function generateSecret() {
  return base32Encode(randomBytes(20));
}

// RFC 4226 HOTP: an HMAC-SHA1 of the 8-byte big-endian counter, truncated per the spec's dynamic
// truncation (offset from the low nibble of the last byte, then the low 31 bits masked off),
// reduced mod 10^digits and zero-padded.
function hotp(secretBase32, counter, digits = 6) {
  const key = base32Decode(secretBase32);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(truncated % 10 ** digits).padStart(digits, "0");
}

// RFC 6238 TOTP: HOTP keyed by the number of `step`-second windows since the Unix epoch.
export function totp(secretBase32, { time = Date.now(), step = 30, digits = 6 } = {}) {
  return hotp(secretBase32, Math.floor(time / 1000 / step), digits);
}

// Verifies a user-entered code against the current time window and `window` windows on either
// side (default 1 -- +/-30s, matching the clock-drift tolerance most authenticator apps and
// verifiers use) so a slow phone clock or network delay between generating and submitting a code
// doesn't spuriously fail. Uses a fixed-length string comparison order (compares the whole
// window range rather than short-circuiting on the exact current window first) so this doesn't
// leak, via timing, which window matched.
export function verifyTotp(secretBase32, code, { time = Date.now(), step = 30, window = 1 } = {}) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(time / 1000 / step);
  let matched = false;
  for (let delta = -window; delta <= window; delta++) {
    if (hotp(secretBase32, counter + delta) === code) matched = true;
  }
  return matched;
}

// The otpauth:// URI most authenticator apps can scan or import directly (as text, or turned
// into a QR code -- see server/router.mjs, which renders one server-side with the `qrcode`
// package rather than asking the frontend to embed a QR library of its own).
export function otpauthUrl(secretBase32, { issuer = "Wayline", accountName }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// Generates `count` recovery codes as plain, human-typeable strings: 16 base32 characters (80
// bits of entropy -- unlike a short numeric PIN, this resists offline brute-forcing even from a
// stolen, unsalted hash) grouped into four blocks of four for readability. The caller is
// responsible for storing only a hash of each and showing the plaintext to the user exactly
// once -- see store.mjs's mfaConfirm(), which mirrors how session tokens and password reset
// tokens are handled here: generated random, shown/used once, only a hash persisted.
export function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const chars = base32Encode(randomBytes(10)).slice(0, 16);
    return chars.match(/.{1,4}/g).join("-");
  });
}

// Strips formatting (hyphens, whitespace) and case so a recovery code hashes the same way at
// generation time and whenever a user later types it back in, however they space or capitalize
// it.
export function normalizeRecoveryCode(code) {
  return String(code)
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "");
}
