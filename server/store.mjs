import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { DomainError } from "./domain/journeys.mjs";
import {
  generateSecret,
  verifyTotp,
  matchTotpCounter,
  otpauthUrl,
  generateRecoveryCodes,
  normalizeRecoveryCode,
} from "./totp.mjs";
const derive = promisify(scrypt);
export const hashToken = (v) => createHash("sha256").update(v).digest("hex");
// R06: node:sqlite doesn't give a typed "this was a UNIQUE violation" error class -- just a
// generic ERR_SQLITE_ERROR with the driver's own message text and, usefully, the underlying
// SQLite extended result code (2067 = SQLITE_CONSTRAINT_UNIQUE) on `errcode`. Checked in two
// places below: put()'s alert dedupe-hash insert and jobs.mjs's push-deliver enqueue, both of
// which treat "the row already exists" as a normal, idempotent outcome rather than an error.
const isUniqueViolation = (e) =>
  e?.errcode === 2067 || /UNIQUE constraint failed/i.test(e?.message ?? "");
// Phase 8 (roadmap features 98/99, hardens 100/101): the minimum number of DISTINCT
// contributing accounts before an aggregate report signal is shown at all -- shared by
// /api/operator's per-type breakdown and /api/community's per-station view so both apply the
// exact same anonymization rule instead of two independently hardcoded "5"s.
export const MIN_REPORT_COHORT = 5;
export const REPORT_STATUSES = ["open", "reviewing", "resolved", "dismissed"];

export class Store {
  constructor({
    directory = process.env.DATA_DIR || resolve("data"),
    key = process.env.DATA_ENCRYPTION_KEY,
    production = process.env.NODE_ENV === "production",
  } = {}) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.directory = directory;
    if (!key) {
      if (production) throw new Error("DATA_ENCRYPTION_KEY is required in production.");
      const path = join(directory, ".encryption-key");
      if (!existsSync(path))
        writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
      key = readFileSync(path, "utf8").trim();
    }
    if (!/^[a-f\d]{64}$/i.test(key))
      throw new Error("DATA_ENCRYPTION_KEY must contain 64 hexadecimal characters.");
    this.key = Buffer.from(key, "hex");
    this.db = new DatabaseSync(join(directory, "wayline.sqlite"));
    chmodSync(join(directory, "wayline.sqlite"), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email_hash TEXT UNIQUE,password_hash TEXT,profile TEXT NOT NULL,created_at INTEGER NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL DEFAULT 0,user_agent TEXT,last_seen_at INTEGER NOT NULL DEFAULT 0) STRICT;
   CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
   CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
   CREATE TABLE IF NOT EXISTS mfa(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,secret TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,recovery_codes TEXT,created_at INTEGER NOT NULL,confirmed_at INTEGER,pending_secret TEXT,pending_created_at INTEGER,last_counter INTEGER) STRICT;
   CREATE TABLE IF NOT EXISTS pending_logins(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL) STRICT;
   CREATE INDEX IF NOT EXISTS idx_pending_logins_user ON pending_logins(user_id);
   CREATE TABLE IF NOT EXISTS recovery_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL,used_at INTEGER) STRICT;
   CREATE INDEX IF NOT EXISTS idx_recovery_tokens_user ON recovery_tokens(user_id);
   CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires_at INTEGER,dedupe_hash TEXT) STRICT;
   CREATE INDEX IF NOT EXISTS idx_records_user_kind_time ON records(user_id,kind,updated_at DESC);
   CREATE INDEX IF NOT EXISTS idx_records_expiry ON records(expires_at) WHERE expires_at IS NOT NULL;
   CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,journey_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,scopes TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT;
   CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
   CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,user_id TEXT,action TEXT NOT NULL,resource_id TEXT,at INTEGER NOT NULL) STRICT;
   CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit(user_id,at DESC);
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 8,interval_ms INTEGER,run_at INTEGER NOT NULL,leased_until INTEGER,leased_by TEXT,lease_token TEXT,last_error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,user_id TEXT REFERENCES users(id) ON DELETE CASCADE) STRICT;
   CREATE INDEX IF NOT EXISTS idx_jobs_status_run ON jobs(status,run_at);
   CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_recurring_kind ON jobs(kind) WHERE interval_ms IS NOT NULL;
   INSERT OR IGNORE INTO schema_version VALUES(1,datetime('now')); PRAGMA optimize;`);
    this.migrateSessionColumns();
    this.migrateJobsColumns();
    this.migrateMfaColumns();
    this.migrateRecordsColumns();
  }
  // R06: a database created before alert dedup had a real database constraint has no
  // dedupe_hash column -- every existing row is NULL there, which the partial unique index
  // below already excludes (`WHERE dedupe_hash IS NOT NULL`), so nothing pre-existing can ever
  // conflict with it; only a new alert insert going through the fixed guardian.mjs sets a
  // non-null value from here on. A fresh install already has the column from CREATE TABLE
  // above, making the ALTER a no-op there.
  migrateRecordsColumns() {
    const columns = this.db
      .prepare("PRAGMA table_info(records)")
      .all()
      .map((c) => c.name);
    if (!columns.includes("dedupe_hash"))
      this.db.exec("ALTER TABLE records ADD COLUMN dedupe_hash TEXT");
    this.db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_records_alert_dedupe ON records(user_id,dedupe_hash) WHERE kind='alert' AND dedupe_hash IS NOT NULL",
    );
  }
  // A database created before R01's fix (an already-active factor could be silently replaced by
  // calling mfaSetup again, and an accepted TOTP code could be replayed) has an mfa table without
  // pending_secret/pending_created_at (the in-flight "replace my factor" enrollment, kept
  // separate from the active secret/enabled columns so the old factor keeps working until the
  // new one is confirmed) or last_counter (the RFC 6238 Section 5.2 replay watermark). A fresh
  // install already has all three from the CREATE TABLE above, making this a no-op there.
  migrateMfaColumns() {
    const columns = this.db
      .prepare("PRAGMA table_info(mfa)")
      .all()
      .map((c) => c.name);
    if (!columns.includes("pending_secret"))
      this.db.exec("ALTER TABLE mfa ADD COLUMN pending_secret TEXT");
    if (!columns.includes("pending_created_at"))
      this.db.exec("ALTER TABLE mfa ADD COLUMN pending_created_at INTEGER");
    if (!columns.includes("last_counter"))
      this.db.exec("ALTER TABLE mfa ADD COLUMN last_counter INTEGER");
  }
  // A database created before session device-management existed (feature 95/96, Phase 3) has a
  // 4-column sessions table; a fresh one already has the 7-column version from the CREATE TABLE
  // above, making this a no-op there. ALTER TABLE ADD COLUMN is safe to run against a live,
  // already-populated table -- SQLite backfills the DEFAULT for every existing row.
  migrateSessionColumns() {
    const columns = this.db
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .map((c) => c.name);
    if (!columns.includes("created_at"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0");
    if (!columns.includes("user_agent"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN user_agent TEXT");
    if (!columns.includes("last_seen_at"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0");
  }
  // A database created before this phase's job/user linkage existed has a jobs table with no
  // user_id column -- a "push-deliver" job's user was only findable inside its JSON payload, so
  // deleteAccount's FK cascades (every other per-user table already has one) never reached it: a
  // deleted account's id could linger in a job row until the unrelated 14-day cleanup() sweep
  // happened to run. The backfill below recovers user_id for jobs whose referenced user still
  // exists; one already orphaned by a user deleted under the old schema is left to cleanup().
  migrateJobsColumns() {
    const columns = this.db
      .prepare("PRAGMA table_info(jobs)")
      .all()
      .map((c) => c.name);
    if (!columns.includes("user_id")) {
      this.db.exec(
        "ALTER TABLE jobs ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE",
      );
      this.db.exec(
        `UPDATE jobs SET user_id=json_extract(payload,'$.userId')
         WHERE user_id IS NULL AND json_extract(payload,'$.userId') IN (SELECT id FROM users)`,
      );
    }
    // R05: a database created before the lease-token ownership check existed has no lease_token
    // column -- any row it already has is, at worst, leased under the old scheme (no token to
    // check), so claimDueJobs's normal expiry/reclaim logic still applies to it unchanged; it
    // simply gets a real token the next time it's claimed.
    if (!columns.includes("lease_token"))
      this.db.exec("ALTER TABLE jobs ADD COLUMN lease_token TEXT");
    // Created here (not in the main DDL block) because a legacy jobs table -- one that exists
    // already, just without user_id -- must get the column added above BEFORE an index on that
    // column can be created; a fresh install's jobs table already has the column from CREATE
    // TABLE, so this is simply always safe to run once the branch above (if it ran) is done.
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id) WHERE user_id IS NOT NULL",
    );
    // R06: one push-delivery job per (alert, subscription) pair, enforced by the database --
    // guardian.mjs's fanOutPush and jobs.mjs's enqueueJob rely on this to make a repeated
    // fan-out attempt (a retried transaction, or the startup orphan-reconciliation pass) a safe
    // no-op instead of a duplicate delivery. A database that somehow already has duplicate
    // push-deliver rows for the same pair -- only possible from pre-R06 code, since nothing
    // after this fix can create one -- would make CREATE UNIQUE INDEX fail outright, so any
    // duplicates are resolved first (keeping the oldest row per pair) before the constraint is
    // added; a fresh/clean database never takes that branch.
    try {
      this.db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_push_dedupe
         ON jobs(kind,json_extract(payload,'$.alertId'),json_extract(payload,'$.subscriptionId'))
         WHERE kind='push-deliver'`,
      );
    } catch {
      this.db.exec(
        `DELETE FROM jobs WHERE kind='push-deliver' AND rowid NOT IN (
           SELECT MIN(rowid) FROM jobs WHERE kind='push-deliver'
           GROUP BY json_extract(payload,'$.alertId'), json_extract(payload,'$.subscriptionId')
         )`,
      );
      this.db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_push_dedupe
         ON jobs(kind,json_extract(payload,'$.alertId'),json_extract(payload,'$.subscriptionId'))
         WHERE kind='push-deliver'`,
      );
    }
  }
  encrypt(value) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
    return [iv, c.getAuthTag(), encrypted].map((b) => b.toString("base64url")).join(".");
  }
  decrypt(value) {
    const [iv, tag, data] = value.split(".").map((s) => Buffer.from(s, "base64url"));
    const c = createDecipheriv("aes-256-gcm", this.key, iv);
    c.setAuthTag(tag);
    return JSON.parse(Buffer.concat([c.update(data), c.final()]).toString("utf8"));
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  emailHash(email) {
    return createHmac("sha256", this.key).update(email.trim().toLowerCase()).digest("hex");
  }
  user(id) {
    const u = this.db.prepare("SELECT * FROM users WHERE id=?").get(id);
    return u ? { id: u.id, registered: Boolean(u.email_hash), ...this.decrypt(u.profile) } : null;
  }
  createGuest() {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO users(id,profile,created_at) VALUES(?,?,?)")
      .run(
        id,
        this.encrypt({ name: "Traveler", email: null, preferences: {}, role: "traveler" }),
        Date.now(),
      );
    return this.user(id);
  }
  updateUser(id, patch) {
    const u = this.user(id);
    if (!u) throw new DomainError("Account not found.", 404);
    delete u.registered;
    delete u.id;
    this.db
      .prepare("UPDATE users SET profile=? WHERE id=?")
      .run(this.encrypt({ ...u, ...patch }), id);
    this.audit(id, "PROFILE_UPDATED", id);
    return this.user(id);
  }
  async register(id, { name, email, password }) {
    validateCredentials(email, password);
    if (typeof name !== "string" || !name.trim() || name.length > 100)
      throw new DomainError("Enter a name of up to 100 characters.");
    if (this.user(id)?.registered)
      throw new DomainError("This session already has an account.", 409);
    const salt = randomBytes(16).toString("hex");
    const result = await derive(password, salt, 64, { N: 16384, r: 8, p: 1 });
    const hash = `${salt}:${result.toString("hex")}`;
    try {
      this.transaction(() => {
        this.db
          .prepare("UPDATE users SET email_hash=?,password_hash=? WHERE id=?")
          .run(this.emailHash(email), hash, id);
        this.updateUser(id, {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: "traveler",
        });
        this.audit(id, "ACCOUNT_REGISTERED", id);
      });
    } catch (e) {
      if (String(e.code).includes("SQLITE_CONSTRAINT"))
        throw new DomainError("An account with this email already exists.", 409);
      throw e;
    }
    return this.user(id);
  }
  async login(email, password) {
    validateCredentials(email, password, false);
    const row = this.db
      .prepare("SELECT id,password_hash FROM users WHERE email_hash=?")
      .get(this.emailHash(email));
    const [salt, expected] = (
      row?.password_hash ?? "00000000000000000000000000000000:" + Buffer.alloc(64).toString("hex")
    ).split(":");
    const actual = await derive(password, salt, 64, { N: 16384, r: 8, p: 1 });
    if (!row || !timingSafeEqual(Buffer.from(expected, "hex"), actual))
      throw new DomainError("Email or password is incorrect.", 401);
    this.audit(row.id, "SIGNED_IN", row.id);
    return this.user(row.id);
  }
  session(userId, { userAgent } = {}) {
    const token = randomBytes(32).toString("base64url"),
      csrf = randomBytes(24).toString("base64url");
    const days = Math.max(1, Math.min(30, Number(process.env.SESSION_DAYS) || 14));
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,csrf,expires_at,created_at,user_agent,last_seen_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        hashToken(token),
        userId,
        csrf,
        now + days * 86400000,
        now,
        String(userAgent ?? "").slice(0, 200),
        now,
      );
    return { token, csrf, userId };
  }
  findSession(token) {
    if (!token) return null;
    const hash = hashToken(token);
    const row =
      this.db
        .prepare(
          "SELECT user_id AS userId,csrf,expires_at FROM sessions WHERE token_hash=? AND expires_at>?",
        )
        .get(hash, Date.now()) ?? null;
    if (row)
      this.db
        .prepare("UPDATE sessions SET last_seen_at=? WHERE token_hash=?")
        .run(Date.now(), hash);
    return row;
  }
  logout(token) {
    const hash = hashToken(token);
    // R10: a Web Push subscription this exact session registered (see router.mjs's
    // push-subscription POST handler, which tags every new subscription with the creating
    // session's own id) is a separate resource from the session row below -- ending the session
    // alone left that subscription live, so an account's alerts could keep reaching a shared
    // device after the person using it signed out (or switched to a different account: register/
    // login/mfa-verify below all call this on the outgoing session before creating the new one).
    // Detaching it here, not only in Profile.tsx's client-side toggle, means this holds even if
    // the tab closes before that client code runs.
    const row = this.db
      .prepare("SELECT user_id AS userId FROM sessions WHERE token_hash=?")
      .get(hash);
    if (row) {
      for (const sub of this.list(row.userId, "push-subscription")) {
        if (sub.sessionId === hash) this.remove(row.userId, sub.id);
      }
    }
    this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash);
  }
  // Lists a user's active sessions (newest-active-first) for a "where you're signed in" screen,
  // marking which one is the caller's own current session so the UI can label/protect it.
  sessions(userId, currentToken) {
    const currentHash = currentToken ? hashToken(currentToken) : null;
    return this.db
      .prepare(
        // last_seen_at has millisecond resolution, so two sessions touched in the same
        // millisecond (easily reachable on fast hardware, as a flaky test caught) would tie
        // under last_seen_at alone; rowid -- monotonically increasing with each insert -- breaks
        // the tie deterministically instead of leaving it to SQLite's unspecified tie order.
        "SELECT token_hash AS id,created_at AS createdAt,user_agent AS userAgent,last_seen_at AS lastSeenAt,expires_at AS expiresAt FROM sessions WHERE user_id=? AND expires_at>? ORDER BY last_seen_at DESC, rowid DESC",
      )
      .all(userId, Date.now())
      .map((row) => ({ ...row, current: row.id === currentHash }));
  }
  // Revokes one specific session by id (its token hash) -- e.g. "sign out that device." Scoped to
  // userId so one account can never revoke another account's session by guessing an id.
  revokeSession(userId, id) {
    const row = this.db
      .prepare("SELECT token_hash FROM sessions WHERE token_hash=? AND user_id=?")
      .get(id, userId);
    if (!row) throw new DomainError("Session not found.", 404);
    this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(id);
    // R10: "revoke that device" should also mean it stops receiving push alerts, not just that
    // it can no longer browse signed in -- see logout()'s matching comment for why this is a
    // separate resource that needs its own cleanup.
    for (const sub of this.list(userId, "push-subscription")) {
      if (sub.sessionId === id) this.remove(userId, sub.id);
    }
    this.audit(userId, "SESSION_REVOKED", id);
  }
  // "Sign out everywhere else" -- keeps the caller's own current session, drops every other one.
  revokeOtherSessions(userId, currentToken) {
    const currentHash = currentToken ? hashToken(currentToken) : "";
    this.db
      .prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?")
      .run(userId, currentHash);
    // R10: same reasoning as revokeSession, for every other device at once. A subscription with
    // no sessionId at all (registered before this fix existed) is left alone here rather than
    // guessed at -- it isn't known to belong to any specific one of the sessions being revoked.
    for (const sub of this.list(userId, "push-subscription")) {
      if (sub.sessionId && sub.sessionId !== currentHash) this.remove(userId, sub.id);
    }
    this.audit(userId, "OTHER_SESSIONS_REVOKED", userId);
  }
  // -- TOTP-based multi-factor authentication (roadmap feature 95) --
  mfaStatus(userId) {
    const row = this.db
      .prepare("SELECT enabled,pending_secret FROM mfa WHERE user_id=?")
      .get(userId);
    return {
      enabled: Boolean(row?.enabled),
      // A replacement enrollment is in flight (R01): the active factor above is still the one
      // that works for login until this is confirmed or a fresh mfaSetup overwrites it again.
      replacementPending: Boolean(row?.pending_secret),
    };
  }
  // Starts (or restarts) MFA enrollment and returns a fresh TOTP secret plus a scannable
  // otpauth:// URL. What happens to any EXISTING factor depends on whether one is active
  // (R01 -- this used to unconditionally disable an active factor, letting a hijacked session
  // downgrade account security with no proof of the old factor at all):
  //   - No factor, or a never-confirmed one: replaces it outright, same as before. There is
  //     nothing active to protect.
  //   - An active (enabled) factor: this call proves nothing about the caller by itself, so the
  //     active factor is left completely untouched -- still the one that satisfies login and
  //     mfaDisable -- and the new secret is parked in pending_secret instead. `replaceCode` must
  //     be a currently-valid code or unused recovery code for the EXISTING factor; only then does
  //     the pending secret get written. Confirming it (mfaConfirm) later promotes pending_secret
  //     into secret; never confirming it (or calling mfaSetup again) simply discards it, so
  //     "cancel a replacement" needs no separate endpoint -- the old factor was never at risk.
  // `now` defaults to the real clock but can be overridden (mirroring server/jobs.mjs's
  // now-parameter pattern) so tests can exercise TOTP time-window behavior deterministically
  // instead of racing real wall-clock seconds.
  mfaSetup(userId, replaceCode, now = Date.now()) {
    const user = this.user(userId);
    if (!user) throw new DomainError("Account not found.", 404);
    const secret = generateSecret();
    const active = this.db.prepare("SELECT enabled FROM mfa WHERE user_id=?").get(userId);
    if (active?.enabled) {
      // Replacing an active factor requires proving possession of it first. Reject a missing
      // code immediately with the same generic message mfaVerifyCode itself uses for a wrong
      // one, rather than letting `undefined` fall through into its recovery-code branch.
      // mfaVerifyCode itself throws 401 on a wrong code and consumes a recovery code if one was
      // used, exactly like every other call that spends proof of the existing factor.
      if (!replaceCode) throw new DomainError("Incorrect code.", 401);
      this.mfaVerifyCode(userId, replaceCode, now);
      this.db
        .prepare("UPDATE mfa SET pending_secret=?,pending_created_at=? WHERE user_id=?")
        .run(this.encrypt(secret), now, userId);
    } else {
      this.db
        .prepare(
          `INSERT INTO mfa(user_id,secret,enabled,recovery_codes,created_at,confirmed_at,pending_secret,pending_created_at,last_counter)
           VALUES(?,?,0,NULL,?,NULL,NULL,NULL,NULL)
           ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,enabled=0,recovery_codes=NULL,created_at=excluded.created_at,confirmed_at=NULL,pending_secret=NULL,pending_created_at=NULL,last_counter=NULL`,
        )
        .run(userId, this.encrypt(secret), now);
    }
    return { secret, otpauthUrl: otpauthUrl(secret, { accountName: user.email ?? user.id }) };
  }
  // Confirms enrollment with a real code from the app. Two cases, mirroring mfaSetup above:
  //   - Fresh enrollment (no active factor yet): verifies against `secret` directly, flips
  //     enabled on, and mints one-time recovery codes (shown to the user exactly once here --
  //     only their hashes are ever persisted).
  //   - Confirming a replacement (an active factor plus a pending_secret from mfaSetup above):
  //     verifies against pending_secret instead, promotes it into secret, mints a fresh set of
  //     recovery codes (the old ones are tied to the old factor and should not survive a
  //     replacement), and clears the pending columns. The previously active factor is never
  //     consulted here -- only the proof already spent back in mfaSetup guarded this path.
  mfaConfirm(userId, code, now = Date.now()) {
    const row = this.db
      .prepare("SELECT secret,enabled,pending_secret FROM mfa WHERE user_id=?")
      .get(userId);
    if (!row) throw new DomainError("Start MFA setup first.", 409);
    const replacing = Boolean(row.enabled) && row.pending_secret;
    const secretToCheck = replacing ? row.pending_secret : row.secret;
    if (!verifyTotp(this.decrypt(secretToCheck), code, { time: now }))
      throw new DomainError("Incorrect code.", 401);
    const codes = generateRecoveryCodes();
    const hashed = codes.map((c) => hashToken(normalizeRecoveryCode(c)));
    if (replacing) {
      this.db
        .prepare(
          "UPDATE mfa SET secret=pending_secret,pending_secret=NULL,pending_created_at=NULL,last_counter=NULL,confirmed_at=?,recovery_codes=? WHERE user_id=?",
        )
        .run(now, this.encrypt(hashed), userId);
      this.audit(userId, "MFA_FACTOR_REPLACED", userId);
    } else {
      this.db
        .prepare("UPDATE mfa SET enabled=1,confirmed_at=?,recovery_codes=? WHERE user_id=?")
        .run(now, this.encrypt(hashed), userId);
      this.audit(userId, "MFA_ENABLED", userId);
    }
    return codes;
  }
  // Verifies either a live TOTP code or an unused recovery code (consuming it on success -- each
  // recovery code works exactly once). Used both by the login MFA challenge and by mfaDisable().
  //
  // R01 also closes a TOTP replay gap here: a plain HOTP/TOTP check alone accepts the SAME code
  // repeatedly for its whole 30s-plus-drift validity window (RFC 6238 Section 5.2 explicitly
  // requires rejecting a second use of an already-accepted time-step). last_counter persists the
  // highest time-step counter ever accepted for this account; a match at or before it is treated
  // as a replay and rejected with the same generic "Incorrect code." response as a wrong code, so
  // a caller learns nothing about why a syntactically valid code failed. The UPDATE is written as
  // a conditional compare-and-set (WHERE last_counter IS NULL OR last_counter<?) rather than a
  // plain SELECT-then-UPDATE, so this stays correct even if this method were ever called
  // concurrently for the same account from two connections instead of relying on Node's
  // single-threaded synchronous execution to serialize it.
  mfaVerifyCode(userId, code, now = Date.now()) {
    const row = this.db
      .prepare("SELECT secret,recovery_codes,last_counter FROM mfa WHERE user_id=? AND enabled=1")
      .get(userId);
    if (!row) throw new DomainError("MFA is not enabled on this account.", 409);
    const counter = matchTotpCounter(this.decrypt(row.secret), code, { time: now });
    if (counter !== null) {
      const result = this.db
        .prepare(
          "UPDATE mfa SET last_counter=? WHERE user_id=? AND (last_counter IS NULL OR last_counter<?)",
        )
        .run(counter, userId, counter);
      if (result.changes === 1) return true;
      // A syntactically valid code whose time-step was already accepted -- reject exactly like a
      // wrong code, not a distinct error, so this can't be used to probe for a real code's value.
      throw new DomainError("Incorrect code.", 401);
    }
    const normalized = normalizeRecoveryCode(code);
    if (!normalized) throw new DomainError("Incorrect code.", 401);
    const hash = hashToken(normalized);
    const codes = row.recovery_codes ? this.decrypt(row.recovery_codes) : [];
    const index = codes.indexOf(hash);
    if (index === -1) throw new DomainError("Incorrect code.", 401);
    codes.splice(index, 1);
    this.db
      .prepare("UPDATE mfa SET recovery_codes=? WHERE user_id=?")
      .run(this.encrypt(codes), userId);
    this.audit(userId, "MFA_RECOVERY_CODE_USED", userId);
    return true;
  }
  // Turns MFA off -- requires proving possession of a valid code or recovery code first, so a
  // stolen session cookie alone can't downgrade account security.
  mfaDisable(userId, code, now = Date.now()) {
    this.mfaVerifyCode(userId, code, now);
    this.db.prepare("DELETE FROM mfa WHERE user_id=?").run(userId);
    this.audit(userId, "MFA_DISABLED", userId);
  }
  // -- MFA login challenge (a short-lived, single-use, non-session token) --
  // Issued after password verification succeeds but before a valid second factor is supplied.
  // Deliberately not a session: it grants no access beyond attempting the second factor, and
  // expires in 5 minutes.
  pendingLogin(userId) {
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare("INSERT INTO pending_logins VALUES(?,?,?)")
      .run(hashToken(token), userId, Date.now() + 5 * 60000);
    return token;
  }
  // Looks up (without consuming) the account a login challenge belongs to, so a wrong code can
  // be retried within the same 5-minute window instead of burning the challenge on one typo.
  peekPendingLogin(token) {
    const row = this.db
      .prepare("SELECT user_id AS userId FROM pending_logins WHERE token_hash=? AND expires_at>?")
      .get(hashToken(token), Date.now());
    if (!row) throw new DomainError("This sign-in attempt has expired. Start again.", 401);
    return row.userId;
  }
  // Consumes (deletes) a login challenge -- call only once the second factor has actually been
  // verified, so a failed attempt never spends the user's one shot at this token.
  consumePendingLogin(token) {
    const userId = this.peekPendingLogin(token);
    this.db.prepare("DELETE FROM pending_logins WHERE token_hash=?").run(hashToken(token));
    return userId;
  }
  // -- Password recovery (roadmap feature 95's other half) --
  // Returns null (silently) when no account matches the email -- the caller must respond
  // identically either way so an attacker can't use this to enumerate registered emails. Actual
  // delivery of the reset link is the router's job, via a pluggable EmailProvider (server/email.mjs).
  createRecoveryToken(email) {
    if (typeof email !== "string" || !email.trim()) return null;
    const row = this.db
      .prepare("SELECT id FROM users WHERE email_hash=?")
      .get(this.emailHash(email));
    if (!row) return null;
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare(
        "INSERT INTO recovery_tokens(token_hash,user_id,expires_at,used_at) VALUES(?,?,?,NULL)",
      )
      .run(hashToken(token), row.id, Date.now() + 3600000);
    this.audit(row.id, "PASSWORD_RESET_REQUESTED", row.id);
    return token;
  }
  // Consumes a single-use reset token, sets a new password, and -- as a security practice, in
  // case the reset was itself triggered by an attacker who already had transient access -- signs
  // the account out everywhere.
  //
  // R02: token consumption must be atomic against concurrent use. The previous version did a
  // plain SELECT (used_at IS NULL) to validate the token, then awaited the (async, event-loop-
  // yielding) password derivation below, and only afterward wrote used_at -- so N concurrent
  // requests carrying the same token could all pass the initial SELECT before any of them had
  // written used_at, and every one of them would go on to "successfully" reset the password.
  // Fixed by doing the derivation first (it doesn't depend on the token row at all) and only
  // then claiming the token with a conditional UPDATE ... WHERE used_at IS NULL inside a single
  // synchronous transaction alongside the password/session writes. Node's sqlite bindings run
  // each statement synchronously and this callback contains no `await`, so once one caller's
  // transaction() call starts, it runs to completion (COMMIT or ROLLBACK) before any other JS
  // callback -- including another resetPassword's own transaction -- gets a turn. Whichever
  // caller's UPDATE lands first is the only one whose WHERE clause can still match; every other
  // concurrent caller's claim reports changes!==1 and is rejected the same as an already-used
  // token.
  async resetPassword(rawToken, newPassword) {
    if (typeof rawToken !== "string" || !rawToken)
      throw new DomainError("Invalid or expired reset link.", 401);
    if (typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 128)
      throw new DomainError("Password must be 12-128 characters.");
    const hash = hashToken(rawToken);
    const salt = randomBytes(16).toString("hex");
    const result = await derive(newPassword, salt, 64, { N: 16384, r: 8, p: 1 });
    this.transaction(() => {
      const now = Date.now();
      const claim = this.db
        .prepare(
          "UPDATE recovery_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
        )
        .run(now, hash, now);
      if (claim.changes !== 1) throw new DomainError("Invalid or expired reset link.", 401);
      const row = this.db
        .prepare("SELECT user_id AS userId FROM recovery_tokens WHERE token_hash=?")
        .get(hash);
      this.db
        .prepare("UPDATE users SET password_hash=? WHERE id=?")
        .run(`${salt}:${result.toString("hex")}`, row.userId);
      this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(row.userId);
      this.audit(row.userId, "PASSWORD_RESET", row.userId);
    });
  }
  list(userId, kind) {
    return this.db
      .prepare(
        "SELECT * FROM records WHERE user_id=? AND kind=? AND (expires_at IS NULL OR expires_at>?) ORDER BY updated_at DESC LIMIT 1000",
      )
      .all(userId, kind, Date.now())
      .map((row) => this.decode(row));
  }
  decode(row) {
    return {
      ...this.decrypt(row.payload),
      id: row.id,
      version: row.version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
  get(userId, id, kind) {
    const row = this.db
      .prepare(
        "SELECT * FROM records WHERE user_id=? AND id=? AND (expires_at IS NULL OR expires_at>?)",
      )
      .get(userId, id, Date.now());
    if (!row || (kind && row.kind !== kind))
      throw new DomainError("Record not found.", 404, "NOT_FOUND");
    return this.decode(row);
  }
  // R06: `dedupeHash` gives a caller (currently only guardian.mjs's alert creation) a real,
  // database-enforced uniqueness constraint for a kind, scoped per-user -- see the partial
  // unique index on records in migrateRecordsColumns. Guardian's own in-memory "have I already
  // made this alert" check only ever sees the newest 1000 alerts per account (this.list's
  // LIMIT), so it cannot catch a duplicate beyond that window by itself; the database can. When
  // a caller passes dedupeHash and loses that race, this returns the row that already holds it
  // instead of throwing -- the same "this already happened, that's fine" idempotence the R02
  // password-reset fix and R05's lease_token guard both rely on elsewhere in this file.
  put(userId, kind, value, { id = randomUUID(), expectedVersion, expiresAt, dedupeHash } = {}) {
    const existing = this.db
      .prepare("SELECT user_id,version,kind,expires_at,dedupe_hash FROM records WHERE id=?")
      .get(id);
    if (existing && (existing.user_id !== userId || existing.kind !== kind))
      throw new DomainError("Record not found.", 404);
    if (existing && (expectedVersion === undefined || existing.version !== expectedVersion))
      throw new DomainError(
        "This item changed in another tab. Refresh and try again.",
        409,
        "VERSION_CONFLICT",
      );
    if (
      this.db.prepare("SELECT count(*) AS n FROM records WHERE user_id=?").get(userId).n >= 3000 &&
      !existing
    )
      throw new DomainError("Account storage limit reached. Export and remove old items.", 429);
    const now = Date.now();
    const expiration = expiresAt === undefined ? (existing?.expires_at ?? null) : expiresAt;
    const dedupe = dedupeHash === undefined ? (existing?.dedupe_hash ?? null) : dedupeHash;
    const payload = { ...value };
    delete payload.id;
    delete payload.version;
    delete payload.createdAt;
    delete payload.updatedAt;
    if (existing) {
      this.db
        .prepare(
          "UPDATE records SET payload=?,version=version+1,updated_at=?,expires_at=?,dedupe_hash=? WHERE id=? AND user_id=?",
        )
        .run(this.encrypt(payload), now, expiration, dedupe, id, userId);
    } else {
      try {
        this.db
          .prepare("INSERT INTO records VALUES(?,?,?,?,1,?,?,?,?)")
          .run(id, userId, kind, this.encrypt(payload), now, now, expiration, dedupe);
      } catch (e) {
        if (dedupe != null && isUniqueViolation(e)) {
          const row = this.db
            .prepare("SELECT id FROM records WHERE user_id=? AND kind=? AND dedupe_hash=?")
            .get(userId, kind, dedupe);
          if (row) return this.get(userId, row.id, kind);
        }
        throw e;
      }
    }
    this.audit(userId, `${kind.toUpperCase()}_${existing ? "UPDATED" : "CREATED"}`, id);
    return this.get(userId, id, kind);
  }
  remove(userId, id) {
    this.get(userId, id);
    this.db.prepare("DELETE FROM records WHERE id=? AND user_id=?").run(id, userId);
    this.audit(userId, "RECORD_DELETED", id);
  }
  // How many OTHER distinct accounts reported the same {station,type} recently -- real
  // confidence weighting for feature 99 (previously `confidence` was always null) computed at
  // report-creation time in router.mjs, and the same lookup pattern /api/community already used
  // for its own distinct-rider count, now shared instead of duplicated.
  reportConfirmations(station, type, { sinceMs = Date.now() - 3600000, excludeUserId } = {}) {
    const rows = this.db
      .prepare("SELECT user_id,payload FROM records WHERE kind='report' AND created_at>?")
      .all(sinceMs);
    const users = new Set();
    for (const r of rows) {
      if (r.user_id === excludeUserId) continue;
      const v = this.decrypt(r.payload);
      if (v.station.toLowerCase() === station.toLowerCase() && v.type === type)
        users.add(r.user_id);
    }
    return users.size;
  }
  // Replaces the old "one global COUNT(*), one threshold" /api/operator behavior with a real
  // per-type breakdown: each report type is only surfaced once at least MIN_REPORT_COHORT
  // *distinct* accounts (not just report rows -- one account filing five reports must not read
  // as five contributors) have reported it inside the window; everything below that is named in
  // `suppressedTypes` with no count attached, so a rare report at a low-ridership stop can't be
  // used to infer who filed it.
  operatorReportBreakdown({
    sinceMs = Date.now() - 24 * 3600000,
    minimumCohort = MIN_REPORT_COHORT,
  } = {}) {
    const rows = this.db
      .prepare("SELECT user_id,payload FROM records WHERE kind='report' AND created_at>?")
      .all(sinceMs);
    const stats = new Map();
    for (const r of rows) {
      const v = this.decrypt(r.payload);
      const s = stats.get(v.type) ?? { count: 0, users: new Set() };
      s.count += 1;
      s.users.add(r.user_id);
      stats.set(v.type, s);
    }
    const breakdown = [],
      suppressedTypes = [];
    for (const [type, s] of stats)
      if (s.users.size >= minimumCohort)
        breakdown.push({ type, reports: s.count, distinctContributors: s.users.size });
      else suppressedTypes.push(type);
    breakdown.sort((a, b) => b.reports - a.reports);
    return {
      breakdown,
      suppressedTypes: suppressedTypes.sort(),
      minimumCohort,
      windowHours: Math.round((Date.now() - sinceMs) / 3600000),
    };
  }
  // An operator's moderation worklist. Deliberately NOT run through get()/list() (both scope by
  // user_id) -- moderating "the elevator at this stop is broken" is an operational ticket, not a
  // demographic signal, so it is not withheld by MIN_REPORT_COHORT the way the aggregate
  // breakdown above is. It still protects reporter identity: decode() never includes user_id, so
  // an operator sees the report's own fields and never who filed it.
  listAllReports({ statuses } = {}) {
    return this.db
      .prepare("SELECT * FROM records WHERE kind='report' ORDER BY created_at DESC LIMIT 500")
      .all()
      .map((row) => this.decode(row))
      .filter((r) => !statuses || statuses.includes(r.status ?? "open"));
  }
  // The one deliberate, narrowly-scoped exception to "records are only ever read/written by
  // their owner" (see systemGetOrder in commerce for the same pattern applied to webhook
  // reconciliation): an operator resolving a data-quality report has to update a record they
  // don't own. It only ever touches status/resolutionNote/moderatedAt -- never the reporter's
  // own fields -- and the change is audited under the REPORTER's user id (so it still shows up
  // in their own history/export) rather than the moderator's, since nothing here currently
  // tracks moderator identity as a first-class actor.
  moderateReport(id, { status, resolutionNote } = {}) {
    if (!REPORT_STATUSES.includes(status)) throw new DomainError("Choose a valid report status.");
    const row = this.db.prepare("SELECT * FROM records WHERE id=? AND kind='report'").get(id);
    if (!row) throw new DomainError("Report not found.", 404, "NOT_FOUND");
    const value = this.decrypt(row.payload);
    value.status = status;
    value.resolutionNote = resolutionNote ? String(resolutionNote).slice(0, 500) : null;
    value.moderatedAt = new Date().toISOString();
    this.db
      .prepare("UPDATE records SET payload=?,version=version+1,updated_at=? WHERE id=?")
      .run(this.encrypt(value), Date.now(), id);
    this.audit(row.user_id, "REPORT_MODERATED", id);
    return this.decode(this.db.prepare("SELECT * FROM records WHERE id=?").get(id));
  }
  audit(userId, action, resourceId = null) {
    this.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?)")
      .run(randomUUID(), userId, action, resourceId, Date.now());
  }
  audits(userId) {
    return this.db
      .prepare(
        "SELECT action,resource_id AS resourceId,at FROM audit WHERE user_id=? ORDER BY at DESC LIMIT 100",
      )
      .all(userId);
  }
  share(userId, journeyId, { hours = 24, location = false } = {}) {
    this.get(userId, journeyId, "journey");
    if (!Number.isInteger(hours) || hours < 1 || hours > 168)
      throw new DomainError("Share expiry must be 1–168 hours.");
    const token = randomBytes(32).toString("base64url"),
      id = randomUUID(),
      expiresAt = Date.now() + hours * 3600000;
    this.db
      .prepare("INSERT INTO shares VALUES(?,?,?,?,?,?)")
      .run(
        id,
        hashToken(token),
        userId,
        journeyId,
        JSON.stringify({ location: Boolean(location) }),
        expiresAt,
      );
    this.audit(userId, "SHARE_CREATED", journeyId);
    return { id, token, expiresAt };
  }
  shares(userId) {
    return this.db
      .prepare(
        "SELECT id,journey_id AS journeyId,expires_at AS expiresAt,scopes FROM shares WHERE user_id=? AND expires_at>?",
      )
      .all(userId, Date.now())
      .map((s) => ({ ...s, scopes: JSON.parse(s.scopes) }));
  }
  revokeShare(userId, id) {
    const result = this.db.prepare("DELETE FROM shares WHERE user_id=? AND id=?").run(userId, id);
    if (!result.changes) throw new DomainError("Share not found.", 404);
    this.audit(userId, "SHARE_REVOKED", id);
  }
  shared(token) {
    const s = this.db
      .prepare("SELECT * FROM shares WHERE token_hash=? AND expires_at>?")
      .get(hashToken(token), Date.now());
    if (!s) throw new DomainError("This sharing link has expired or was revoked.", 404);
    const j = this.get(s.user_id, s.journey_id, "journey");
    const location = JSON.parse(s.scopes).location;
    return {
      from: j.from,
      to: j.to,
      departure: j.departure,
      arrival: j.arrival,
      state: j.state,
      dataMode: j.dataMode,
      updatedAt: j.updatedAt,
      expiresAt: s.expires_at,
      location: location
        ? j.legs
            .filter((l) => l.tracking?.source === "live-gps")
            .map((l) => ({
              operator: l.operator,
              position: l.tracking.position,
              observedAt: l.tracking.observedAt,
            }))
        : undefined,
    };
  }
  // Sessions, MFA enrollment state and share links are just as much "my data" as records
  // and audit history -- none of the three expose a raw credential (sessions/shares carry a
  // hashed token id, mfa is only the enrolled boolean, never the secret or recovery hashes).
  // System-scoped order lookup for the sandbox commerce webhook (server/commerce-routes.mjs's
  // reconcileOrder) -- a provider webhook carries no user session, only the opaque order id it
  // is settling, so this looks the record up directly instead of through the normal
  // userId-scoped get(). Never call this from a routed per-user endpoint.
  systemGetOrder(id) {
    const row = this.db.prepare("SELECT * FROM records WHERE id=? AND kind='order'").get(id);
    if (!row) throw new DomainError("Order not found.", 404);
    return { userId: row.user_id, order: this.decode(row) };
  }
  export(userId) {
    const rows = this.db
      .prepare("SELECT * FROM records WHERE user_id=? ORDER BY created_at")
      .all(userId);
    return {
      exportedAt: new Date().toISOString(),
      profile: this.user(userId),
      records: rows.map((r) => ({ kind: r.kind, ...this.decode(r) })),
      sessions: this.sessions(userId, null),
      mfa: this.mfaStatus(userId),
      shares: this.shares(userId),
      audit: this.audits(userId),
    };
  }
  deleteHistory(userId) {
    this.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM records WHERE user_id=? AND kind IN ('journey','ticket','claim','alert','agent','report','search','recovery','idempotency','order','quote')",
        )
        .run(userId);
      // Deleting 'alert' rows above can orphan a still-pending push-deliver job queued for
      // one of them (see push.mjs's fanOutPush) -- it would otherwise no-op at delivery time
      // and only physically disappear via cleanup()'s unrelated 14-day sweep. This is the
      // "derived data too, not just the primary record" half of history deletion.
      this.db
        .prepare(
          `DELETE FROM jobs WHERE kind='push-deliver' AND user_id=? AND status='pending'
           AND NOT EXISTS(SELECT 1 FROM records WHERE id=json_extract(jobs.payload,'$.alertId') AND kind='alert')`,
        )
        .run(userId);
      this.audit(userId, "HISTORY_DELETED");
    });
  }
  // Every per-user table besides `audit` (kept deliberately, for a forensic trail that can
  // outlive one deletion) has a real FK to users with ON DELETE CASCADE -- sessions, mfa,
  // pending_logins, recovery_tokens, records (every kind, including push-subscription),
  // shares, and now jobs (Phase 4). Deleting the user row alone propagates to all of them.
  deleteAccount(userId) {
    this.transaction(() => {
      this.db.prepare("DELETE FROM users WHERE id=?").run(userId);
      this.db.prepare("DELETE FROM audit WHERE user_id=?").run(userId);
    });
  }
  cleanup(now = Date.now()) {
    this.db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
    this.db.prepare("DELETE FROM shares WHERE expires_at<=?").run(now);
    this.db.prepare("DELETE FROM records WHERE expires_at IS NOT NULL AND expires_at<=?").run(now);
    this.db.prepare("DELETE FROM audit WHERE at<?").run(now - 90 * 86400000);
    this.db
      .prepare(
        "DELETE FROM users WHERE email_hash IS NULL AND created_at<? AND NOT EXISTS(SELECT 1 FROM sessions WHERE sessions.user_id=users.id)",
      )
      .run(now - 14 * 86400000);
    // Finished one-shot jobs are kept for a while so a dead-lettered job can still be reviewed
    // (see server/jobs.mjs) -- 14 days matches the guest-account retention above, not a
    // requirement of the job system itself.
    this.db
      .prepare("DELETE FROM jobs WHERE status IN ('done','dead') AND updated_at<?")
      .run(now - 14 * 86400000);
    this.db.prepare("DELETE FROM pending_logins WHERE expires_at<=?").run(now);
    // Used or expired recovery tokens are kept briefly (not deleted the instant they're consumed)
    // so a support investigation into a disputed reset has something to look at; unused ones
    // still expire on schedule via the second clause.
    this.db
      .prepare(
        "DELETE FROM recovery_tokens WHERE (used_at IS NOT NULL AND used_at<?) OR expires_at<=?",
      )
      .run(now - 7 * 86400000, now);
  }
  close() {
    this.db.close();
  }
}
function validateCredentials(email, password, registration = true) {
  if (typeof email !== "string" || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email))
    throw new DomainError("Enter a valid email address.");
  if (
    typeof password !== "string" ||
    password.length > 128 ||
    password.length < (registration ? 12 : 1)
  )
    throw new DomainError("Use a password between 12 and 128 characters.");
}
