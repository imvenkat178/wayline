import {startJobWorkers} from './jobWorkers.mjs';
import {sweepSupplierMonitors,checkSupplierMonitor} from './shopping/supplierMonitoring.mjs';
import {contentSecurityPolicy} from './securityPolicy.mjs';
import {AeroApiProvider} from './shopping/aeroapi.mjs';
import { DuffelBookingAdapter } from './shopping/duffelBooking.mjs';
import { runBookingOperation } from './shopping/booking.mjs';
import { handleDuffelWebhook } from './shopping/webhooks.mjs';
import { runConversationExecution } from './domain/conversationExecution.mjs';
import { sweepPriceWatches } from "./shopping/watches.mjs";
import { runShoppingQuery,runShoppingConnections } from "./shopping/service.mjs";
import { TravelClient } from "./travel/client.mjs";
import { refreshActiveJourneys, scheduleLiveRefresh } from "./recovery.mjs";
import { createBackup } from "./backups.mjs";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Store } from "./store.mjs";
import { DomainError } from "./domain/journeys.mjs";
import { handleApi } from "./router.mjs";
import { providerHealth } from "./adapters/providers.mjs";
import { runGuardian, reconcileOrphanedAlerts } from "./guardian.mjs";
import { ensureRecurringJob } from "./jobs.mjs";
import { configureWebPush, deliverPush } from "./push.mjs";
import { LogEmailProvider } from "./email.mjs";
import { handleCommerceWebhook } from "./commerce-routes.mjs";
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
async function body(req, maxBytes = 1_000_000) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json"))
    throw new DomainError("Send JSON content.", 415);
  let length = 0;
  const parts = [];
  for await (const c of req) {
    length += c.length;
    if (length > maxBytes) {
      // Bail out before the client has finished sending. Do NOT destroy the socket here --
      // req and res share it, and destroying it now would kill the connection before the 413
      // response below ever reaches the client (the request would just look like a connection
      // reset). Instead this is tagged BODY_TOO_LARGE so the top-level handler can send the
      // response first and only then force the (still not fully drained) connection closed,
      // which is what actually prevents server.close() from hanging on it afterwards.
      throw new DomainError("Request is too large.", 413, "BODY_TOO_LARGE");
    }
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
  store = new Store({ backups: true }),
  travel = new TravelClient(),
  bookingAdapter = new DuffelBookingAdapter(),
  flightStatusProvider = new AeroApiProvider(),
  checkoutProvider = null,
  production = process.env.NODE_ENV === "production",
  quiet = false,
  // No real email provider is configured in this codebase yet (see server/email.mjs) -- this
  // default logs instead of sending, and is clearly labeled as such in every user-visible
  // response that depends on it (the recovery/request endpoint's message, FEATURE_STATUS.md,
  // README.md). Passing a real provider here is the only change needed once one exists.
  emailProvider = new LogEmailProvider({ quiet }),
  // Configurable purely so tests can exercise the drain loop's overlap-prevention (R05) on a
  // real, tiny interval instead of either waiting 30 real seconds or reaching for mock timers.
  drainIntervalMs = 5000,
  immediateJobs = true,
} = {}) {
  if (production && !process.env.PUBLIC_ORIGIN)
    throw new Error("PUBLIC_ORIGIN is required in production.");
  // The periodic sweep is itself a durable job now (see server/jobs.mjs), not a bare function
  // call from the timer below -- seeding it is idempotent, so this is safe on every startup.
  ensureRecurringJob(store, "guardian-sweep", {}, 30000);
  // R06: repair any alert left orphaned (no push-delivery job ever queued for it) by pre-fix
  // code -- see guardian.mjs. Idempotent, so safe on every startup.
  reconcileOrphanedAlerts(store);
  // Generates (on first boot) or loads the persisted VAPID keypair and sets it process-wide --
  // see push.mjs. Must run before any request can read bootstrap's pushPublicKey field, and
  // before the "push-deliver" jobs below can actually send anything.
  configureWebPush(store.directory);
  if (process.env.OTP_GRAPHQL_URL) {
    ensureRecurringJob(store, "live-refresh", {}, 60000);
    ensureRecurringJob(store, "travel-probe", {}, 300000);
  }
  if (store.backupsEnabled) ensureRecurringJob(store, "database-backup", {}, 3600000);
  ensureRecurringJob(store, "price-watch-sweep", {}, 60000);
  ensureRecurringJob(store,"supplier-monitor-sweep",{},60000);
  const jobHandlers = {
    "supplier-monitor-sweep": jobStore=>sweepSupplierMonitors(jobStore),
    "supplier-monitor-check": (jobStore,payload,job)=>checkSupplierMonitor(jobStore,payload,flightStatusProvider,()=>!!jobStore.db.prepare("SELECT id FROM jobs WHERE id=? AND lease_token=? AND status='leased'").get(job.id,job.lease_token)),
    "booking-operation": (jobStore,payload) => runBookingOperation(jobStore,payload.userId,payload.operationId,bookingAdapter,{refresh:payload.refresh===true}),
    "conversation-execution": (jobStore,payload) => runConversationExecution(jobStore,payload.userId,payload.executionId,travel),
    "price-watch-sweep": (jobStore) => sweepPriceWatches(jobStore,{capabilities:travel.flightShoppingCapabilities}),
    "shopping-query": (jobStore, payload, job) => runShoppingQuery(jobStore, travel, payload, () => !!jobStore.db.prepare("SELECT id FROM jobs WHERE id=? AND lease_token=? AND status='leased'").get(job.id,job.lease_token)),
    "shopping-connection": (jobStore, payload, job) => runShoppingConnections(jobStore, travel, payload, () => !!jobStore.db.prepare("SELECT id FROM jobs WHERE id=? AND lease_token=? AND status='leased'").get(job.id,job.lease_token)),
    "live-refresh": (jobStore) => scheduleLiveRefresh(jobStore),
    "travel-probe": () => travel.probe(),
    "journey-refresh": (jobStore, payload, job) => {
      const deadline = Date.now() + 48000;
      return refreshActiveJourneys(jobStore, travel, {
        journeyId: payload.journeyId,
        canCommit: () =>
          Date.now() < deadline &&
          jobStore.db
            .prepare("SELECT id FROM jobs WHERE id=? AND lease_token=? AND status='leased'")
            .get(job.id, job.lease_token),
      });
    },
    "database-backup": (jobStore) => {
      try {
        return createBackup(jobStore);
      } catch (e) {
        jobStore.backupStatus = { ...jobStore.backupStatus, status: "failed" };
        throw e;
      }
    },
    "guardian-sweep": (jobStore) => runGuardian(jobStore),
    "push-deliver": (jobStore, payload) => deliverPush(jobStore, payload),
  };
  travel.flightStatusProvider=flightStatusProvider;
  travel.bookingAdapter=bookingAdapter;
  travel.checkoutProvider=checkoutProvider;
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader("x-request-id", requestId);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("permissions-policy", "camera=(self), microphone=(self), geolocation=(self)");
    res.setHeader(
      "content-security-policy",
      contentSecurityPolicy(bookingAdapter.capabilities.book),
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
          providers: [travel.status, ...providerHealth()],
          requestId,
        });
      if (url.pathname.startsWith("/api/shared/") && req.method === "GET") {
        rateLimit(`share:${req.socket.remoteAddress}`, 60);
        return send(res, 200, store.shared(url.pathname.slice("/api/shared/".length)));
      }
      // Unauthenticated by design, exactly like /api/shared/ above -- a sandbox payment
      // provider's webhook callback has no session cookie and no CSRF token, only a signed
      // body (see commerce-routes.mjs's handleCommerceWebhook and adapters/payments.mjs's
      // verifyWebhookSignature). Never routed through handleApi's session-gated dispatch.
      if(url.pathname==='/api/shopping/webhooks/duffel' && req.method==='POST') {
        rateLimit('duffel-webhook:'+req.socket.remoteAddress,120);
        return await handleDuffelWebhook({req,res,store,send,bookingAdapter});
      }
      if (url.pathname === "/api/commerce/webhook" && req.method === "POST") {
        rateLimit(`webhook:${req.socket.remoteAddress}`, 120);
        return await handleCommerceWebhook({ req, res, store, send });
      }
      if (url.pathname.startsWith("/api/")) {
        let token = cookies(req).wayline_session;
        let session = store.findSession(token);
        if (url.pathname === "/api/bootstrap" && req.method === "GET") {
          if (!session) {
            rateLimit(`guest:${req.socket.remoteAddress}`, 20, 3600000);
            const u = store.createGuest();
            session = store.session(u.id, { userAgent: req.headers["user-agent"] });
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
          // In the documented two-terminal dev workflow (README: `npm run dev` serving the
          // frontend from Vite on one port, `npm start` serving this API on another), the
          // browser's real Origin header is the Vite port, but this server's own computed
          // `origin` above is itself -- a different port. Vite's proxy forwards the request
          // (and, depending on version, may rewrite Host), but it can never rewrite the
          // browser-set Origin header, so that mismatch is expected there, not a spoofed
          // cross-site request. Allow exactly one additional, explicitly configured dev
          // origin, and only when not in production -- production keeps the single strict
          // PUBLIC_ORIGIN pin unchanged, with no dev bypass at all.
          const devOrigin =
            !production && (process.env.DEV_CLIENT_ORIGIN ?? "http://127.0.0.1:5173");
          if (
            req.headers.origin &&
            req.headers.origin !== origin &&
            req.headers.origin !== devOrigin
          )
            throw new DomainError("Origin is not allowed.", 403);
          if (req.headers["sec-fetch-site"] === "cross-site")
            throw new DomainError("Cross-site requests are not allowed.", 403);
          if (req.headers["x-csrf-token"] !== session.csrf)
            throw new DomainError("Refresh your session before making changes.", 403, "CSRF");
        }
        // Ticket imports (roadmap features 18/19, Phase 6) can attach a base64-encoded photo
        // alongside a manually entered ticket -- comfortably larger than any other request
        // body in this API, so that one route gets a specifically raised, still-bounded cap
        // (server/records.mjs's validateTicketDocument enforces the real limit) rather than
        // loosening the shared 1 MB default every other endpoint relies on.
        const b = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
          ? await body(req, /^\/api\/records\/ticket(?:\/[^/]+)?$/.test(url.pathname) ? 8_000_000 : 1_000_000)
          : {};
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
          emailProvider,
          bookingAdapter,
          travel,
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
      if (!res.headersSent) {
        // A BODY_TOO_LARGE rejection means the request stream was abandoned mid-read (see
        // body() above) -- the client may still be sending bytes we're never going to consume.
        // Ask for the connection to close once this response is flushed (rather than being kept
        // alive for reuse) and, once it actually finishes, destroy the socket so the leftover
        // unread bytes can't leave it half-open -- exactly the kind of lingering connection a
        // later server.close() would otherwise wait on forever.
        const closeAfter = e.code === "BODY_TOO_LARGE";
        send(
          res,
          status,
          {
            error: status === 500 ? "Something went wrong. Try again." : e.message,
            code: e.code ?? "INTERNAL_ERROR",
            requestId,
          },
          {
            ...(status === 429 ? { "retry-after": "60" } : {}),
            ...(closeAfter ? { connection: "close" } : {}),
          },
        );
        if (closeAfter) res.on("finish", () => req.destroy());
      } else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  const workers=startJobWorkers(store,jobHandlers,{pollMs:drainIntervalMs,immediate:immediateJobs,onError:(error,lane)=>{if(!quiet)console.error(JSON.stringify({level:"error",message:"Job worker failed",lane,error:error.name}));}});
  let stopped;
  function stopBackgroundJobs(){return stopped??=(async()=>{await workers.stop();await travel.close();})();}
  server.on("close",()=>{void stopBackgroundJobs();});
  return { server, store, stopBackgroundJobs };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const activePidFile = join(process.env.DATA_DIR || resolve("data"), ".server-pid");
  if (existsSync(activePidFile)) {
    const pid = Number(readFileSync(activePidFile, "utf8"));
    try {
      process.kill(pid, 0);
      throw new Error(
        "Wayline is already running for this data directory. Stop the current server before starting another.",
      );
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  }
  const { server, store, stopBackgroundJobs } = createApplication();
  const pidFile = join(store.directory, ".server-pid");

  process.on("exit", () => {
    if (existsSync(pidFile) && readFileSync(pidFile, "utf8") === String(process.pid))
      unlinkSync(pidFile);
  });
  const port = Number(process.env.PORT ?? 4174);
  const host = process.env.HOST ?? "127.0.0.1";
  server.listen(port, host, () => {
    writeFileSync(pidFile, String(process.pid));
    console.log(`Wayline is ready at http://${host}:${port}`);
  });
  let shuttingDown = false;
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      server.close(async () => {
        // R05: stop claiming new work and let any drain already in flight finish (or hit its own
        // handler deadline) BEFORE the database is closed underneath it -- closing while a
        // handler still has an open statement would otherwise throw out of that handler's own
        // async callback after this process has already committed to exiting.
        try {
          await stopBackgroundJobs();
        } finally {
          store.close();
          process.exit(0);
        }
      });
      setTimeout(() => process.exit(1), 10000).unref();
    });
}
