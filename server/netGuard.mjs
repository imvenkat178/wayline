import { isIP } from "node:net";

// Shared server-side request forgery (SSRF) defenses (R03). Two call sites use this:
//   - server/records.mjs validates a push subscription's endpoint URL against the allowlist
//     below at REGISTRATION time (the only thing it can check -- it never resolves DNS).
//   - server/push.mjs re-validates the actual DNS-resolved address at DELIVERY time, right
//     before the socket connects, using isForbiddenAddress. That second check is what actually
//     stops the request: even a hostname that passed the allowlist could, in principle, later
//     resolve to a private/loopback/link-local address (a compromised or rebound DNS answer), and
//     only a check against the address the connection is about to use closes that gap -- checking
//     the hostname string alone cannot.

function ipv4Octets(address) {
  return address.split(".").map(Number);
}

// True for any IPv4 address that is not an ordinary routable public-unicast address: loopback,
// RFC 1918 private space, link-local (which includes the 169.254.169.254 cloud metadata address
// used by every major cloud provider), carrier-grade NAT, "this network", the documentation and
// benchmarking ranges, and multicast/reserved space at the top of the range.
export function isForbiddenIPv4(address) {
  const octets = ipv4Octets(address);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255))
    return true; // malformed -- fail closed
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 -- "this" network
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 -- loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 -- carrier-grade NAT
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 -- link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 -- IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 -- benchmarking
  if (a === 198 && b === 51) return true; // 198.51.100.0/24 -- TEST-NET-2
  if (a === 203 && b === 0) return true; // 203.0.113.0/24 -- TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255
  return false;
}

// True for any IPv6 address that is not an ordinary routable public-unicast address: unspecified,
// loopback, unique-local (fc00::/7), link-local (fe80::/10), multicast (ff00::/8), and any
// IPv4-mapped or IPv4-compatible address whose embedded IPv4 address is itself forbidden above.
export function isForbiddenIPv6(address) {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isForbiddenIPv4(mapped[1]);
  const compatible = normalized.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (compatible) return isForbiddenIPv4(compatible[1]);
  const firstGroup = normalized.split(":").find((g) => g !== "") ?? "0";
  const firstWord = parseInt(firstGroup, 16);
  if (Number.isNaN(firstWord)) return true; // malformed -- fail closed
  if ((firstWord & 0xfe00) === 0xfc00) return true; // fc00::/7 -- unique local
  if ((firstWord & 0xffc0) === 0xfe80) return true; // fe80::/10 -- link-local
  if ((firstWord & 0xff00) === 0xff00) return true; // ff00::/8 -- multicast
  return false;
}

// Checks a literal IP address (never a hostname -- resolve first) of either family.
export function isForbiddenAddress(address) {
  const family = isIP(address);
  if (family === 4) return isForbiddenIPv4(address);
  if (family === 6) return isForbiddenIPv6(address);
  return true; // not a recognizable literal address -- fail closed
}

// A small, maintained allowlist of the browser push services actually in use (RFC 8030
// implementations). Registering an endpoint on any other host is rejected outright -- a much
// stronger defense than trying to enumerate every private/internal address a hostname could
// resolve to, and it's what the review asked for ("a maintained policy for supported browser
// push-service destinations"). Update this list if a supported browser changes its push
// infrastructure or a new one needs to be supported.
const ALLOWED_PUSH_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge, Samsung Internet, other Chromium-based browsers
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari (macOS 13+ / iOS 16.4+)
  "notify.windows.com", // Legacy Edge / WNS
];
export function isAllowedPushHost(hostname) {
  const host = String(hostname).toLowerCase();
  return ALLOWED_PUSH_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
}
