import { randomUUID } from "node:crypto";
import { hashToken, MIN_REPORT_COHORT } from "./store.mjs";
import {
  cities,
  states,
  agencies,
  discoverAgencies,
  stationGuide,
  operatorLinks,
} from "./catalog.mjs";
import {
  DomainError,
  text,
  preferences,
  sampleSearch,
  fareCompare,
  airportDeadline,
  transitions,
  withFreshTracking,
} from "./domain/journeys.mjs";
import { runAgentGraph } from "./domain/agentGraph.mjs";
import {
  mbtaVehicles,
  mbtaAlerts,
  providerHealth,
  gbfs,
  weather,
  geocode,
  streetRoute,
  otpSearch,
  commercialCapabilities,
  gtfsRealtime,
  configuredSources,
} from "./adapters/providers.mjs";
import { validateRecord } from "./records.mjs";
import { journeyRoutes } from "./journey-routes.mjs";
import { commerceRoutes } from "./commerce-routes.mjs";
import { runGuardian } from "./guardian.mjs";
import { pushPublicKey } from "./push.mjs";
import QRCode from "qrcode";
export async function handleApi(ctx) {
  const {
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
  } = ctx;
  const userId = session.userId;
  const userAgent = String(req.headers["user-agent"] ?? "").slice(0, 200);
  if (url.pathname === "/api/bootstrap") {
    const user = store.user(userId);
    return send(res, 200, {
      user: { ...user, preferences: preferences(user.preferences) },
      csrf: session.csrf,
      cities,
      states,
      capabilities: commercialCapabilities(),
      transitions,
      operatorLinks,
      // The VAPID public key the frontend needs for PushManager.subscribe's
      // applicationServerKey (see server/push.mjs and src/pages/Profile.tsx). Null until
      // configureWebPush() has run in this process, which server.mjs does at startup.
      pushPublicKey: pushPublicKey(),
      mfaEnabled: store.mfaStatus(userId).enabled,
    });
  }
  if (url.pathname === "/api/auth/register" && req.method === "POST") {
    rateLimit(`auth:${req.socket.remoteAddress}`, 10, 900000);
    const user = await store.register(userId, b);
    store.logout(token);
    const next = store.session(user.id, { userAgent });
    addCookie(res, next.token, production);
    return send(res, 201, {
      user: { ...user, preferences: preferences(user.preferences) },
      csrf: next.csrf,
    });
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    rateLimit(`auth:${req.socket.remoteAddress}`, 10, 900000);
    const user = await store.login(b.email, b.password);
    // If this account has MFA enabled, don't finish switching the session over yet -- issue a
    // short-lived, single-use challenge token instead and require /api/auth/mfa-verify to
    // supply a valid code before any session actually changes hands.
    if (store.mfaStatus(user.id).enabled) {
      const pendingToken = store.pendingLogin(user.id);
      return send(res, 200, { mfaRequired: true, pendingToken });
    }
    store.logout(token);
    const next = store.session(user.id, { userAgent });
    addCookie(res, next.token, production);
    return send(res, 200, {
      user: { ...user, preferences: preferences(user.preferences) },
      csrf: next.csrf,
    });
  }
  if (url.pathname === "/api/auth/mfa-verify" && req.method === "POST") {
    rateLimit(`mfa-verify:${req.socket.remoteAddress}`, 10, 900000);
    // Peek (don't consume) so a wrong code leaves the challenge intact for a retry within its
    // 5-minute window -- only a verified code actually spends it (see consumePendingLogin).
    const pendingUserId = store.peekPendingLogin(b.pendingToken);
    store.mfaVerifyCode(pendingUserId, b.code);
    store.consumePendingLogin(b.pendingToken);
    store.logout(token);
    const next = store.session(pendingUserId, { userAgent });
    addCookie(res, next.token, production);
    const user = store.user(pendingUserId);
    return send(res, 200, {
      user: { ...user, preferences: preferences(user.preferences) },
      csrf: next.csrf,
    });
  }
  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    store.logout(token);
    addCookie(res, "", production);
    return send(res, 200, { ok: true });
  }
  // -- Password recovery (server/email.mjs's LogEmailProvider until a real provider is wired
  // in -- see docs/FEATURE_STATUS.md and README.md for that gap). The response is identical
  // whether or not the email matches an account, so this endpoint can't be used to enumerate
  // registered emails.
  if (url.pathname === "/api/auth/recovery/request" && req.method === "POST") {
    rateLimit(`recovery:${req.socket.remoteAddress}`, 5, 900000);
    const resetToken = store.createRecoveryToken(b.email);
    if (resetToken) {
      const link = `${url.origin}/#reset-password?token=${resetToken}`;
      await emailProvider.send({
        to: b.email,
        subject: "Reset your Wayline password",
        text: `Use this link within the next hour to reset your password: ${link}

If you didn't request this, you can ignore this email.`,
      });
    }
    return send(res, 200, {
      ok: true,
      message: "If that email has an account, a reset link has been sent to it.",
    });
  }
  if (url.pathname === "/api/auth/recovery/reset" && req.method === "POST") {
    rateLimit(`recovery-reset:${req.socket.remoteAddress}`, 10, 900000);
    await store.resetPassword(b.token, b.password);
    return send(res, 200, { ok: true });
  }
  // -- Session/device management (roadmap feature 95) --
  if (url.pathname === "/api/sessions" && req.method === "GET")
    return send(res, 200, store.sessions(userId, token));
  if (url.pathname === "/api/sessions/revoke-others" && req.method === "POST") {
    store.revokeOtherSessions(userId, token);
    return send(res, 200, { ok: true });
  }
  if (url.pathname.startsWith("/api/sessions/") && req.method === "DELETE") {
    store.revokeSession(userId, url.pathname.slice("/api/sessions/".length));
    return send(res, 200, { ok: true });
  }
  // -- TOTP multi-factor authentication (roadmap feature 95) --
  if (url.pathname === "/api/mfa/setup" && req.method === "POST") {
    const setup = store.mfaSetup(userId);
    const qrCode = await QRCode.toDataURL(setup.otpauthUrl);
    return send(res, 200, { ...setup, qrCode });
  }
  if (url.pathname === "/api/mfa/confirm" && req.method === "POST") {
    rateLimit(`mfa-confirm:${userId}`, 10, 900000);
    const recoveryCodes = store.mfaConfirm(userId, b.code);
    return send(res, 200, { recoveryCodes });
  }
  if (url.pathname === "/api/mfa/disable" && req.method === "POST") {
    rateLimit(`mfa-disable:${userId}`, 10, 900000);
    store.mfaDisable(userId, b.code);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/api/profile" && req.method === "PUT")
    return send(
      res,
      200,
      store.updateUser(userId, {
        name: text(b.name, "Name", 100),
        preferences: preferences(b.preferences),
      }),
    );
  if (url.pathname === "/api/privacy/export" && req.method === "GET")
    return send(res, 200, store.export(userId), {
      "content-disposition": 'attachment; filename="wayline-data.json"',
    });
  if (url.pathname === "/api/privacy/history" && req.method === "DELETE") {
    if (b.confirm !== "DELETE") throw new DomainError("Confirm deletion by typing DELETE.");
    store.deleteHistory(userId);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/api/privacy/account" && req.method === "DELETE") {
    if (b.confirm !== "DELETE") throw new DomainError("Confirm deletion by typing DELETE.");
    store.deleteAccount(userId);
    addCookie(res, "", production);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/api/audit" && req.method === "GET")
    return send(res, 200, store.audits(userId));
  if (url.pathname === "/api/search" && req.method === "POST") {
    rateLimit(`search:${userId}`, 30);
    const p = preferences({ ...store.user(userId).preferences, ...b.preferences });
    const input = { ...b, preferences: p };
    const result = b.mode === "provider" ? await otpSearch(input) : sampleSearch(input);
    const search = store.put(
      userId,
      "search",
      { input, result },
      { expiresAt: Date.now() + 3600000 },
    );
    return send(res, 200, {
      ...result,
      searchId: search.id,
      agencies: discoverAgencies(b.from, b.to),
    });
  }
  if (url.pathname === "/api/journeys" && req.method === "GET")
    return send(
      res,
      200,
      store.list(userId, "journey").map((j) => withFreshTracking(j)),
    );
  if (url.pathname === "/api/journeys" && req.method === "POST") {
    const key = text(req.headers["idempotency-key"], "Idempotency key", 100);
    const requestHash = hashToken(
      JSON.stringify({ searchId: b.searchId, journeyId: b.journeyId, private: b.private }),
    );
    const result = store.transaction(() => {
      const prior = store.list(userId, "idempotency").find((x) => x.key === key);
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new DomainError("Idempotency key was used for a different request.", 409);
        return store.get(userId, prior.journeyId, "journey");
      }
      const search = store.get(userId, b.searchId, "search");
      const selected = search.result.journeys.find((j) => j.id === b.journeyId);
      if (!selected) throw new DomainError("Journey not found in your search.", 404);
      const p = preferences(store.user(userId).preferences);
      const privateTrip = Boolean(b.private) || !p.saveHistory || p.historyDays === 0;
      const expires = privateTrip
        ? Date.parse(selected.arrival) + 86400000
        : Date.now() + p.historyDays * 86400000;
      const j = store.put(
        userId,
        "journey",
        {
          ...selected,
          state: "PLANNED",
          bookingConfirmed: false,
          privateTrip,
          events: [
            {
              id: randomUUID(),
              at: new Date().toISOString(),
              type: "JOURNEY_SAVED",
              source: "traveler",
            },
          ],
        },
        { expiresAt: Math.max(Date.now() + 3600000, expires) },
      );
      store.put(
        userId,
        "idempotency",
        { key, requestHash, journeyId: j.id },
        { expiresAt: Date.now() + 86400000 },
      );
      return j;
    });
    return send(res, 201, result);
  }
  if (url.pathname.startsWith("/api/journeys/")) return journeyRoutes(ctx);
  if (url.pathname.startsWith("/api/commerce/")) return commerceRoutes(ctx);
  if (url.pathname === "/api/shares" && req.method === "GET")
    return send(res, 200, store.shares(userId));
  if (url.pathname.startsWith("/api/shares/") && req.method === "DELETE") {
    store.revokeShare(userId, url.pathname.split("/").pop());
    return send(res, 200, { ok: true });
  }
  const recordMatch = url.pathname.match(
    /^\/api\/records\/(favorite|traveler|contact|commute|pass|ticket|report|claim|recovery|alert|push-subscription)(?:\/([^/]+))?$/,
  );
  if (recordMatch) {
    const [, kind, id] = recordMatch;
    if (req.method === "GET")
      return send(res, 200, id ? store.get(userId, id, kind) : store.list(userId, kind));
    if (req.method === "POST" && !id) {
      const value = validateRecord(kind, b);
      if (
        ["favorite", "commute"].includes(kind) &&
        (!cities.some((c) => c.id === value.from) ||
          !cities.some((c) => c.id === value.to) ||
          value.from === value.to)
      )
        throw new DomainError("Choose different supported endpoints.");
      if (kind === "ticket" && value.journeyId) store.get(userId, value.journeyId, "journey");
      if (kind === "report") {
        // Real confidence weighting (roadmap feature 99) -- how many OTHER distinct accounts
        // reported the same station+type in the last hour, not the always-null placeholder
        // this used to be. Capped at 1 so a busy stop can't produce a confidence above 100%.
        const confirmations = store.reportConfirmations(value.station, value.type, {
          excludeUserId: userId,
        });
        value.confirmations = confirmations;
        value.confidence = Math.min(1, (confirmations + 1) / MIN_REPORT_COHORT);
      }
      if (kind === "push-subscription") {
        // Re-subscribing the same device/browser (a token refresh, a service-worker update)
        // yields the same endpoint URL -- upsert on it so that produces one updated record, not
        // an ever-growing pile of stale duplicates that would each get their own delivery job.
        const existing = store
          .list(userId, "push-subscription")
          .find((s) => s.endpoint === value.endpoint);
        return send(
          res,
          201,
          store.put(
            userId,
            kind,
            value,
            existing ? { id: existing.id, expectedVersion: existing.version } : {},
          ),
        );
      }
      return send(
        res,
        201,
        store.put(userId, kind, value, {
          // Was 24h; a real moderation lifecycle (open -> reviewing -> resolved/dismissed, see
          // store.moderateReport) needs more than a day to actually happen, so this now matches
          // the same 7-day window most other short-lived records elsewhere in this codebase use.
          expiresAt: kind === "report" ? Date.now() + 7 * 24 * 3600000 : undefined,
        }),
      );
    }
    if (req.method === "DELETE" && id) {
      store.get(userId, id, kind);
      store.remove(userId, id);
      return send(res, 200, { ok: true });
    }
    if (req.method === "PATCH" && id && kind === "alert") {
      const a = store.get(userId, id, kind);
      return send(
        res,
        200,
        store.put(userId, kind, { ...a, read: true }, { id, expectedVersion: b.version }),
      );
    }
  }
  if (url.pathname === "/api/agent" && req.method === "POST") {
    rateLimit(`agent:${userId}`, 20);
    const input = text(b.input, "Message", 2000);
    let journey = b.journeyId ? store.get(userId, b.journeyId, "journey") : null;
    if (!journey && b.searchId) {
      const search = store.get(userId, b.searchId, "search");
      journey = search.result.journeys.find((j) => j.id === b.candidateId) ?? null;
    }
    const history = store.list(userId, "agent").slice(0, 10).reverse();
    const reply = await runAgentGraph({
      input,
      journey,
      preferences: preferences(store.user(userId).preferences),
      history: history.flatMap((h) => [
        { role: "user", content: h.input },
        { role: "assistant", content: h.reply },
      ]),
    });
    store.put(
      userId,
      "agent",
      { input, ...reply, journeyId: journey?.id ?? null },
      { expiresAt: Date.now() + 86400000 },
    );
    return send(res, 200, reply);
  }
  if (url.pathname === "/api/agent/history" && req.method === "GET")
    return send(res, 200, store.list(userId, "agent").slice(0, 30).reverse());
  if (url.pathname === "/api/guardian/check" && req.method === "POST") {
    runGuardian(store, userId);
    return send(res, 200, store.list(userId, "alert"));
  }
  if (url.pathname === "/api/fares/compare" && req.method === "POST")
    return send(res, 200, fareCompare(b));
  if (url.pathname === "/api/airport/deadline" && req.method === "POST")
    return send(res, 200, airportDeadline(b));
  if (url.pathname === "/api/registry" && req.method === "GET") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase(),
      state = url.searchParams.get("state");
    return send(res, 200, {
      agencies: agencies.filter(
        (a) =>
          (!state || state === "all" || a.state === state) &&
          (!q || `${a.name} ${a.city} ${a.state}`.toLowerCase().includes(q)),
      ),
      health: providerHealth(),
      configuredSources: configuredSources().map(({ id, name, kind }) => ({ id, name, kind })),
      notice:
        "Curated discovery seed covering 50 states and DC. This is not a complete national agency or feed inventory.",
    });
  }
  if (url.pathname === "/api/discovery" && req.method === "GET")
    return send(
      res,
      200,
      discoverAgencies(url.searchParams.get("from"), url.searchParams.get("to")),
    );
  if (url.pathname.startsWith("/api/stations/") && req.method === "GET") {
    const s = stationGuide(url.pathname.split("/").pop());
    if (!s) throw new DomainError("Station not found.", 404);
    return send(res, 200, s);
  }
  if (url.pathname === "/api/mbta/vehicles" && req.method === "GET")
    return send(res, 200, await mbtaVehicles());
  if (url.pathname === "/api/mbta/alerts" && req.method === "GET")
    return send(res, 200, await mbtaAlerts());
  if (url.pathname === "/api/gbfs" && req.method === "GET") return send(res, 200, await gbfs());
  if (url.pathname.startsWith("/api/gtfs-rt/") && req.method === "GET")
    return send(res, 200, await gtfsRealtime(url.pathname.split("/").pop()));
  if (url.pathname === "/api/weather" && req.method === "GET")
    return send(
      res,
      200,
      await weather(Number(url.searchParams.get("lat")), Number(url.searchParams.get("lon"))),
    );
  if (url.pathname === "/api/geocode" && req.method === "GET")
    return send(res, 200, await geocode(text(url.searchParams.get("q"), "Address", 180)));
  if (url.pathname === "/api/route" && req.method === "POST")
    return send(res, 200, await streetRoute(b));
  if (url.pathname === "/api/analytics" && req.method === "GET") {
    const journeys = store.list(userId, "journey"),
      completed = journeys.filter((j) => j.state === "ARRIVED");
    const actual = journeys.filter((j) => j.dataMode === "provider");
    return send(res, 200, {
      planned: journeys.length,
      completed: completed.length,
      sampleTrips: journeys.filter((j) => j.dataMode === "illustrative").length,
      recordedBudgetCents: journeys.reduce((n, j) => n + (j.price.totalCents ?? 0), 0),
      purchasedSpendCents: null,
      travelMinutes: completed.reduce((n, j) => n + j.durationMinutes, 0),
      sampleCarbonSavedKg:
        Math.round(
          journeys.reduce(
            (n, j) => n + Math.max(0, (j.drivingCarbonKg ?? 0) - (j.carbonKg ?? 0)),
            0,
          ) * 10,
        ) / 10,
      onTimeRate: null,
      operatorPerformance: [
        ...new Set(
          actual.flatMap((j) => j.legs.filter((l) => l.mode !== "walk").map((l) => l.operator)),
        ),
      ].map((operator) => ({
        operator,
        sampleSize: actual.filter((j) => j.legs.some((l) => l.operator === operator)).length,
        onTimeRate: null,
      })),
      notice: "Saved estimates are not spending. On-time statistics require observed arrivals.",
    });
  }
  if (url.pathname === "/api/operator" && req.method === "GET") {
    if (store.user(userId).role !== "operator")
      throw new DomainError("Operator access is required.", 403);
    // Phase 8 (roadmap feature 98, hardens 99-101): replaces the old single global
    // COUNT(*)-and-one-threshold response with a genuine per-type aggregation-threshold
    // breakdown -- see store.operatorReportBreakdown for what changed and why.
    const { breakdown, suppressedTypes, minimumCohort, windowHours } =
      store.operatorReportBreakdown();
    return send(res, 200, {
      dataQualityReports: breakdown,
      suppressedTypes,
      minimumCohort,
      windowHours,
      health: providerHealth(),
      notice: "No individual routes, identities or precise locations are disclosed.",
    });
  }
  // An operator's moderation worklist (roadmap feature 99's "use reports carefully"): every
  // open/reviewing report, regardless of how few distinct accounts filed it -- unlike the
  // aggregate breakdown above, this is a ticket queue for something operationally actionable
  // (an elevator really is broken), not a demographic signal, so it is deliberately NOT
  // withheld by minimumCohort. The reporter's identity still never appears (store.decode()
  // never includes user_id).
  if (url.pathname === "/api/operator/reports" && req.method === "GET") {
    if (store.user(userId).role !== "operator")
      throw new DomainError("Operator access is required.", 403);
    return send(res, 200, store.listAllReports({ statuses: ["open", "reviewing"] }));
  }
  const moderateMatch = url.pathname.match(/^\/api\/operator\/reports\/([^/]+)$/);
  if (moderateMatch && req.method === "PATCH") {
    if (store.user(userId).role !== "operator")
      throw new DomainError("Operator access is required.", 403);
    return send(res, 200, store.moderateReport(moderateMatch[1], b));
  }
  if (url.pathname === "/api/community" && req.method === "GET") {
    const station = text(url.searchParams.get("station"), "Station", 160);
    const recent = store.db
      .prepare("SELECT user_id,payload FROM records WHERE kind='report' AND created_at>?")
      .all(Date.now() - 3600000);
    const matched = recent
      .map((r) => ({ user: r.user_id, ...store.decrypt(r.payload) }))
      .filter((r) => r.station.toLowerCase() === station.toLowerCase());
    const riders = new Set(matched.map((r) => r.user)).size;
    return send(res, 200, {
      station,
      riders: riders >= MIN_REPORT_COHORT ? riders : null,
      threshold: MIN_REPORT_COHORT,
      reports: riders >= MIN_REPORT_COHORT ? [...new Set(matched.map((r) => r.type))] : [],
      source: "Unverified reports in the last hour",
    });
  }
  if (url.pathname.startsWith("/api/booking") || url.pathname.startsWith("/api/payments"))
    throw new DomainError(
      "Ticketing and payments are not connected. Complete purchases with the operator.",
      409,
      "PROVIDER_REQUIRED",
    );
  throw new DomainError("Endpoint not found.", 404, "NOT_FOUND");
}
