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
  otpauthUrl,
  generateRecoveryCodes,
  normalizeRecoveryCode,
} from "./totp.mjs";
const derive = promisify(scrypt);
export const hashToken = (v) => createHash("sha256").update(v).digest("hex");
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
   CREATE TABLE IF NOT EXISTS mfa(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,secret TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,recovery_codes TEXT,created_at INTEGER NOT NULL,confirmed_at INTEGER) STRICT;
   CREATE TABLE IF NOT EXISTS pending_logins(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL) STRICT;
   CREATE INDEX IF NOT EXISTS idx_pending_logins_user ON pending_logins(user_id);
   CREATE TABLE IF NOT EXISTS recovery_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL,used_at INTEGER) STRICT;
   CREATE INDEX IF NOT EXISTS idx_recovery_tokens_user ON recovery_tokens(user_id);
   CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires_at INTEGER) STRICT;
   CREATE INDEX IF NOT EXISTS idx_records_user_kind_time ON records(user_id,kind,updated_at DESC);
   CREATE INDEX IF NOT EXISTS idx_records_expiry ON records(expires_at) WHERE expires_at IS NOT NULL;
   CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,journey_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,scopes TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT;
   CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
   CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,user_id TEXT,action TEXT NOT NULL,resource_id TEXT,at INTEGER NOT NULL) STRICT;
   CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit(user_id,at DESC);
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 8,interval_ms INTEGER,run_at INTEGER NOT NULL,leased_until INTEGER,leased_by TEXT,last_error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL) STRICT;
   CREATE INDEX IF NOT EXISTS idx_jobs_status_run ON jobs(status,run_at);
   CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_recurring_kind ON jobs(kind) WHERE interval_ms IS NOT NULL;
   INSERT OR IGNORE INTO schema_version VALUES(1,datetime('now')); PRAGMA optimize;`);
    this.migrateSessionColumns();
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
    this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token));
  }
  // Lists a user's active sessions (newest-active-first) for a "where you're signed in" screen,
  // marking which one is the caller's own current session so the UI can label/protect it.
  sessions(userId, currentToken) {
    const currentHash = currentToken ? hashToken(currentToken) : null;
    return this.db
      .prepare(
        "SELECT token_hash AS id,created_at AS createdAt,user_agent AS userAgent,last_seen_at AS lastSeenAt,expires_at AS expiresAt FROM sessions WHERE user_id=? AND expires_at>? ORDER BY last_seen_at DESC",
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
    this.audit(userId, "SESSION_REVOKED", id);
  }
  // "Sign out everywhere else" -- keeps the caller's own current session, drops every other one.
  revokeOtherSessions(userId, currentToken) {
    const currentHash = currentToken ? hashToken(currentToken) : "";
    this.db
      .prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?")
      .run(userId, currentHash);
    this.audit(userId, "OTHER_SESSIONS_REVOKED", userId);
  }
  // -- TOTP-based multi-factor authentication (roadmap feature 95) --
  mfaStatus(userId) {
    const row = this.db.prepare("SELECT enabled FROM mfa WHERE user_id=?").get(userId);
    return { enabled: Boolean(row?.enabled) };
  }
  // Starts (or restarts) MFA enrollment: generates a fresh TOTP secret and returns it plus a
  // scannable otpauth:// URL. Not enabled yet -- enabled flips to true only once mfaConfirm()
  // proves the user actually has the secret loaded in an authenticator app.
  mfaSetup(userId) {
    const user = this.user(userId);
    if (!user) throw new DomainError("Account not found.", 404);
    const secret = generateSecret();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO mfa(user_id,secret,enabled,recovery_codes,created_at,confirmed_at) VALUES(?,?,0,NULL,?,NULL)
         ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,enabled=0,recovery_codes=NULL,created_at=excluded.created_at,confirmed_at=NULL`,
      )
      .run(userId, this.encrypt(secret), now);
    return { secret, otpauthUrl: otpauthUrl(secret, { accountName: user.email ?? user.id }) };
  }
  // Confirms enrollment with a real code from the app, flips MFA on, and mints one-time recovery
  // codes (shown to the user exactly once here -- only their hashes are ever persisted).
  mfaConfirm(userId, code) {
    const row = this.db.prepare("SELECT secret FROM mfa WHERE user_id=?").get(userId);
    if (!row) throw new DomainError("Start MFA setup first.", 409);
    if (!verifyTotp(this.decrypt(row.secret), code)) throw new DomainError("Incorrect code.", 401);
    const codes = generateRecoveryCodes();
    const hashed = codes.map((c) => hashToken(normalizeRecoveryCode(c)));
    this.db
      .prepare("UPDATE mfa SET enabled=1,confirmed_at=?,recovery_codes=? WHERE user_id=?")
      .run(Date.now(), this.encrypt(hashed), userId);
    this.audit(userId, "MFA_ENABLED", userId);
    return codes;
  }
  // Verifies either a live TOTP code or an unused recovery code (consuming it on success -- each
  // recovery code works exactly once). Used both by the login MFA challenge and by mfaDisable().
  mfaVerifyCode(userId, code) {
    const row = this.db
      .prepare("SELECT secret,recovery_codes FROM mfa WHERE user_id=? AND enabled=1")
      .get(userId);
    if (!row) throw new DomainError("MFA is not enabled on this account.", 409);
    if (
      typeof code === "string" &&
      /^\d{6}$/.test(code) &&
      verifyTotp(this.decrypt(row.secret), code)
    )
      return true;
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
  mfaDisable(userId, code) {
    this.mfaVerifyCode(userId, code);
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
  async resetPassword(rawToken, newPassword) {
    if (typeof rawToken !== "string" || !rawToken)
      throw new DomainError("Invalid or expired reset link.", 401);
    const hash = hashToken(rawToken);
    const row = this.db
      .prepare(
        "SELECT user_id AS userId FROM recovery_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
      )
      .get(hash, Date.now());
    if (!row) throw new DomainError("Invalid or expired reset link.", 401);
    if (typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 128)
      throw new DomainError("Password must be 12-128 characters.");
    const salt = randomBytes(16).toString("hex");
    const result = await derive(newPassword, salt, 64, { N: 16384, r: 8, p: 1 });
    this.transaction(() => {
      this.db
        .prepare("UPDATE users SET password_hash=? WHERE id=?")
        .run(`${salt}:${result.toString("hex")}`, row.userId);
      this.db
        .prepare("UPDATE recovery_tokens SET used_at=? WHERE token_hash=?")
        .run(Date.now(), hash);
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
  put(userId, kind, value, { id = randomUUID(), expectedVersion, expiresAt } = {}) {
    const existing = this.db
      .prepare("SELECT user_id,version,kind,expires_at FROM records WHERE id=?")
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
    const payload = { ...value };
    delete payload.id;
    delete payload.version;
    delete payload.createdAt;
    delete payload.updatedAt;
    if (existing) {
      this.db
        .prepare(
          "UPDATE records SET payload=?,version=version+1,updated_at=?,expires_at=? WHERE id=? AND user_id=?",
        )
        .run(this.encrypt(payload), now, expiration, id, userId);
    } else {
      this.db
        .prepare("INSERT INTO records VALUES(?,?,?,?,1,?,?,?)")
        .run(id, userId, kind, this.encrypt(payload), now, now, expiration);
    }
    this.audit(userId, `${kind.toUpperCase()}_${existing ? "UPDATED" : "CREATED"}`, id);
    return this.get(userId, id, kind);
  }
  remove(userId, id) {
    this.get(userId, id);
    this.db.prepare("DELETE FROM records WHERE id=? AND user_id=?").run(id, userId);
    this.audit(userId, "RECORD_DELETED", id);
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
  export(userId) {
    const rows = this.db
      .prepare("SELECT * FROM records WHERE user_id=? ORDER BY created_at")
      .all(userId);
    return {
      exportedAt: new Date().toISOString(),
      profile: this.user(userId),
      records: rows.map((r) => ({ kind: r.kind, ...this.decode(r) })),
      audit: this.audits(userId),
    };
  }
  deleteHistory(userId) {
    this.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM records WHERE user_id=? AND kind IN ('journey','ticket','claim','alert','agent','report','search','recovery','idempotency')",
        )
        .run(userId);
      this.audit(userId, "HISTORY_DELETED");
    });
  }
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
