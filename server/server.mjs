import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Store } from "./store.mjs";
import { DomainError } from "./domain/journeys.mjs";
import { handleApi } from "./router.mjs";
import { providerHealth } from "./adapters/providers.mjs";
import { runGuardian } from "./guardian.mjs";
import { processJobs, ensureRecurringJob } from "./jobs.mjs";
import { configureWebPush, deliverPush } from "./push.mjs";
const ROOT = resolve(fileURLToPath(new URL("../standalone/", import.meta.url)));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".gz": "application/gzip",
};
const buckets = new Map();
export function rateLimit(key, limit, window = 60000) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.reset) {
    b = { n: 0, reset: now + window };
    buckets.set(key, b);
  }
  if (++b.n > limit)
    throw new DomainError("Too many requests. Please try again shortly.", 429, "RATE_LIMIT");
  if (buckets.size > 20000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}
function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((s) => {
        const i = s.indexOf("=");
        return i < 0 ? [] : [s.slice(0, i).trim(), s.slice(i + 1)];
      })
      .filter((x) => x.length === 2),
  );
}
export function send(res, status, data, extra = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extra,
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json"))
    throw new DomainError("Send JSON content.", 415);
  let length = 0;
  const parts = [];
  for await (const c of req) {
    length += c.length;
    if (length > 1_000_000) throw new DomainError("Request is too large.", 413);
    parts.push(c);
  }
  try {
    const d = JSON.parse(Buffer.concat(parts).toString() || "{}");
    if (!d || typeof d !== "object" || Array.isArray(d)) throw 0;
    return d;
  } catch {
    throw new DomainError("Invalid JSON body.");
  }
}
export function addCookie(res, token, production) {
  res.setHeader(
    "set-cookie",
    `wayline_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${token ? 14 * 86400 : 0}${production ? "; Secure" : ""}`,
  );
}
export function createApplication({
  store = new Store(),
  production = process.env.NODE_ENV === "production",
  quiet = false,
} = {}) {
  if (production && !process.env.PUBLIC_ORIGIN)
    throw new Error("PUBLIC_ORIGIN is required in production.");
  // The periodic sweep is itself a durable job now (see server/jobs.mjs), not a bare function
  // call from the timer below -- seeding it is idempotent, so this is safe on every startup.
  ensureRecurringJob(store, "guardian-sweep", {}, 30000);
  // Generates (on first boot) or loads the persisted VAPID keypair and sets it process-wide --
  // see push.mjs. Must run before any request can read bootstrap's pushPublicKey field, and
  // before the "push-deliver" jobs below can actually send anything.
  configureWebPush(store.directory);
  const jobHandlers = {
    "guardian-sweep": (jobStore) => runGuardian(jobStore),
    "push-deliver": (jobStore, payload) => deliverPush(jobStore, payload),
  };
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader("x-request-id", requestId);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("permissions-policy", "camera=(self), microphone=(self), geolocation=(self)");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.tile.openstreetmap.org; connect-src 'self' https://demotiles.maplibre.org https://*.tile.openstreetmap.org https://tessdata.projectnaptha.com; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (production) res.setHeader("strict-transport-security", "max-age=31536000");
    try {
      rateLimit(`ip:${req.socket.remoteAddress}`, 360);
      const origin = process.env.PUBLIC_ORIGIN ?? `http://${req.headers.host}`;
      const url = new URL(req.url, origin);
      if (url.pathname === "/api/health")
        return send(res, 200, {
          ok: true,
          version: "2.0.0",
          uptimeSeconds: Math.floor(process.uptime()),
          ai: process.env.OLLAMA_MODEL ? "Ollama configured" : "Rules assistant",
          providers: providerHealth(),
          requestId,
        });
      if (url.pathname.startsWith("/api/shared/") && req.method === "GET") {
        rateLimit(`share:${req.socket.remoteAddress}`, 60);
        return send(res, 200, store.shared(url.pathname.slice("/api/shared/".length)));
      }
      if (url.pathname.startsWith("/api/")) {
        let token = cookies(req).wayline_session;
        let session = store.findSession(token);
        if (url.pathname === "/api/bootstrap" && req.method === "GET") {
          if (!session) {
            rateLimit(`guest:${req.socket.remoteAddress}`, 20, 3600000);
            const u = store.createGuest();
            session = store.session(u.id);
            token = session.token;
            addCookie(res, token, production);
          }
        } else if (!session)
          throw new DomainError(
            "Your session expired. Reload to continue.",
            401,
            "SESSION_EXPIRED",
          );
        if (!["GET", "HEAD"].includes(req.method)) {
          if (req.headers.origin && req.headers.origin !== origin)
            throw new DomainError("Origin is not allowed.", 403);
          if (req.headers["sec-fetch-site"] === "cross-site")
            throw new DomainError("Cross-site requests are not allowed.", 403);
          if (req.headers["x-csrf-token"] !== session.csrf)
            throw new DomainError("Refresh your session before making changes.", 403, "CSRF");
        }
        const b = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await body(req) : {};
        return await handleApi({
          req,
          res,
          url,
          b,
          store,
          session,
          token,
          production,
          rateLimit,
          send,
          addCookie,
        });
      }
      if (!["GET", "HEAD"].includes(req.method)) throw new DomainError("Method not allowed.", 405);
      let path;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        throw new DomainError("Malformed URL.");
      }
      if (path.includes("\0") || path.includes("\\")) throw new DomainError("Invalid path.");
      const file = resolve(ROOT, `.${path === "/" ? "/index.html" : path}`);
      if (file !== ROOT && !file.startsWith(ROOT + sep)) throw new DomainError("Not found.", 404);
      let actual = file;
      try {
        if (!(await stat(actual)).isFile()) throw 0;
      } catch {
        if (extname(path)) throw new DomainError("File not found.", 404);
        actual = join(ROOT, "index.html");
      }
      const bytes = await readFile(actual);
      res.writeHead(200, {
        "content-type": MIME[extname(actual)] ?? "application/octet-stream",
        "cache-control": actual.includes("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        "content-length": bytes.length,
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch (e) {
      const status = e instanceof DomainError ? e.status : 500;
      if (status === 500 && !quiet)
        console.error(
          JSON.stringify({ level: "error", requestId, error: e.name, message: "Request failed" }),
        );
      if (!res.headersSent)
        send(
          res,
          status,
          {
            error: status === 500 ? "Something went wrong. Try again." : e.message,
            code: e.code ?? "INTERNAL_ERROR",
            requestId,
          },
          status === 429 ? { "retry-after": "60" } : {},
        );
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  const timer = setInterval(() => {
    try {
      store.cleanup();
    } catch (e) {
      if (!quiet)
        console.error(JSON.stringify({ level: "error", message: "Cleanup failed", error: e.name }));
    }
    processJobs(store, jobHandlers, { now: Date.now() }).catch((e) => {
      if (!quiet)
        console.error(
          JSON.stringify({ level: "error", message: "Job processing failed", error: e.name }),
        );
    });
  }, 30000);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  return { server, store };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, store } = createApplication();
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? "127.0.0.1";
  server.listen(port, host, () => console.log(`Wayline is ready at http://${host}:${port}`));
  let shuttingDown = false;
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      server.close(() => {
        store.close();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000).unref();
    });
}
