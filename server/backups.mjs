import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pattern = /^wayline-[0-9T-]+-[a-z-]+-[a-f0-9-]+\.wlbackup$/;
export function backupDirectory(store) {
  return resolve(store.backupDir ?? process.env.BACKUP_DIR ?? join(store.directory, "backups"));
}
function protect(path) {
  if (process.platform === "win32") {
    const identity = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
      encoding: "utf8",
      windowsHide: true,
    }).match(/S-1-5-[0-9-]+/)[0];
    execFileSync(
      "icacls.exe",
      [path, "/inheritance:r", "/grant:r", "*" + identity + ":F", "*S-1-5-18:F"],
      { stdio: "ignore", windowsHide: true },
    );
  }
}
function archiveKey(store) {
  const p = process.env.BACKUP_RECOVERY_KEY_FILE ?? join(store.directory, ".backup-recovery-key");
  if (!existsSync(p)) {
    writeFileSync(p, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
    protect(p);
  }
  const key = readFileSync(p, "utf8").trim();
  if (!/^[a-f0-9]{64}$/i.test(key)) throw Error("Invalid backup recovery key");
  return Buffer.from(key, "hex");
}
export function createBackup(store, { reason = "hourly", now = Date.now() } = {}) {
  const dir = backupDirectory(store);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = join(store.directory, ".snapshot-" + randomUUID() + ".sqlite");
  let partial;
  try {
    store.db.prepare("VACUUM INTO ?").run(temp);
    const database = readFileSync(temp),
      key = archiveKey(store);
    const vapid = join(store.directory, ".vapid-keys.json");
    const body = gzipSync(
      Buffer.from(
        JSON.stringify({
          format: 1,
          createdAt: new Date(now).toISOString(),
          reason,
          database: database.toString("base64"),
          sha256: checksum(database),
          encryptionKey: store.key.toString("hex"),
          vapid: existsSync(vapid) ? readFileSync(vapid, "utf8") : null,
        }),
      ),
    );
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv),
      encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
    const file = join(
      dir,
      "wayline-" +
        new Date(now).toISOString().replace(/[:.Z]/g, "-") +
        "-" +
        reason +
        "-" +
        randomUUID() +
        ".wlbackup",
    );
    partial = file + ".part";
    writeFileSync(
      partial,
      Buffer.concat([Buffer.from("WLBA1"), iv, cipher.getAuthTag(), encrypted]),
      { mode: 0o600, flag: "wx" },
    );
    protect(file + ".part");
    renameSync(file + ".part", file);
    rotate(dir);
    store.backupStatus = {
      status: "ready",
      lastSuccess: new Date(now).toISOString(),
      reason,
      localOnly: true,
    };
    return file;
  } finally {
    if (partial && existsSync(partial)) unlinkSync(partial);
    if (existsSync(temp)) unlinkSync(temp);
  }
}
function rotate(dir) {
  const files = readdirSync(dir)
    .filter((x) => pattern.test(x))
    .sort()
    .reverse();
  const keep = new Set(files.filter((f) => f.includes("-hourly-")).slice(0, 24));
  if (files[0]) keep.add(files[0]);
  const days = new Set();
  for (const f of files) {
    const day = f.slice(8, 18);
    if (!days.has(day) && days.size < 7) {
      days.add(day);
      keep.add(f);
    }
  }
  for (const f of files) if (!keep.has(f)) unlinkSync(join(dir, f));
}
export function purgeBackupsAfterDeletion(store) {
  const dir = backupDirectory(store);
  for (const name of readdirSync(store.directory))
    if (/^(wayline\.sqlite|\.encryption-key|\.vapid-keys\.json)\.before-restore-\d+$/.test(name))
      unlinkSync(join(store.directory, name));
  if (existsSync(dir))
    for (const f of readdirSync(dir))
      if (pattern.test(f) || (f.endsWith(".part") && pattern.test(f.slice(0, -5))))
        unlinkSync(join(dir, f));
  return createBackup(store, { reason: "privacy" });
}
export function decodeBackup(file, keyFile) {
  const key = Buffer.from(readFileSync(keyFile, "utf8").trim(), "hex"),
    raw = readFileSync(file);
  if (raw.subarray(0, 5).toString() !== "WLBA1") throw Error("Unsupported backup");
  const decrypt = createDecipheriv("aes-256-gcm", key, raw.subarray(5, 17));
  decrypt.setAuthTag(raw.subarray(17, 33));
  const data = JSON.parse(
    gunzipSync(Buffer.concat([decrypt.update(raw.subarray(33)), decrypt.final()])).toString(),
  );
  const database = Buffer.from(data.database, "base64");
  if (
    data.format !== 1 ||
    checksum(database) !== data.sha256 ||
    !/^[a-f0-9]{64}$/i.test(data.encryptionKey)
  )
    throw Error("Backup integrity check failed");
  return { ...data, database };
}
export function restoreBackup(args) {
  const target = resolve(args.directory);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const lock = join(target, ".restore-lock");
  writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  try {
    return restoreStoppedBackup(args);
  } finally {
    unlinkSync(lock);
  }
}
function restoreStoppedBackup({ file, keyFile, directory }) {
  const target = resolve(directory);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const lock = join(target, ".server-pid");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    try {
      process.kill(pid, 0);
      throw Error("Stop the Wayline server before restoring.");
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  }
  const data = decodeBackup(file, keyFile);
  if (process.env.DATA_ENCRYPTION_KEY && process.env.DATA_ENCRYPTION_KEY !== data.encryptionKey)
    throw Error(
      "The configured DATA_ENCRYPTION_KEY does not match this backup. Restore in a clean operator environment and use the restored key on startup.",
    );
  const temp = join(target, ".restore-" + randomUUID() + ".sqlite");
  writeFileSync(temp, data.database, { mode: 0o600, flag: "wx" });
  const db = new DatabaseSync(temp);
  try {
    if (Object.values(db.prepare("PRAGMA integrity_check").get())[0] !== "ok")
      throw Error("SQLite integrity check failed");
    for (const row of db
      .prepare(
        "SELECT profile AS encrypted FROM users UNION ALL SELECT payload AS encrypted FROM records",
      )
      .all()) {
      const [iv, tag, bytes] = row.encrypted.split(".").map((x) => Buffer.from(x, "base64url"));
      const decipher = createDecipheriv("aes-256-gcm", Buffer.from(data.encryptionKey, "hex"), iv);
      decipher.setAuthTag(tag);
      JSON.parse(Buffer.concat([decipher.update(bytes), decipher.final()]).toString());
    }
    if (db.prepare("SELECT name FROM sqlite_master WHERE name='journey_observations'").get())
      db.exec("DELETE FROM journey_observations");
    db.exec(
      "DELETE FROM sessions; DELETE FROM pending_logins; DELETE FROM recovery_tokens; DELETE FROM records WHERE kind IN ('pending-action','push-subscription'); DELETE FROM jobs WHERE kind='push-deliver'; UPDATE jobs SET status='pending',leased_until=NULL,leased_by=NULL,lease_token=NULL WHERE status='leased';",
    );
  } catch (e) {
    db.close();
    unlinkSync(temp);
    throw e;
  }
  db.close();
  const live = join(target, "wayline.sqlite");
  const suffix = ".before-restore-" + Date.now();
  const paths = [live, join(target, ".encryption-key"), join(target, ".vapid-keys.json")];
  const stages = [temp, temp + ".key", temp + ".vapid"];
  const moved = [],
    installed = [];
  try {
    writeFileSync(stages[1], data.encryptionKey, { mode: 0o600, flag: "wx" });
    protect(stages[1]);
    if (data.vapid) {
      JSON.parse(data.vapid);
      writeFileSync(stages[2], data.vapid, { mode: 0o600, flag: "wx" });
      protect(stages[2]);
    }
    protect(temp);
    if (existsSync(live)) {
      const old = new DatabaseSync(live);
      try {
        old.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        old.close();
      }
    }
    for (const path of paths) {
      if (existsSync(path)) {
        renameSync(path, path + suffix);
        moved.push(path);
      }
    }
    for (const ext of ["-wal", "-shm"]) if (existsSync(live + ext)) unlinkSync(live + ext);
    for (let i = 0; i < paths.length; i++) {
      if (existsSync(stages[i])) {
        renameSync(stages[i], paths[i]);
        installed.push(paths[i]);
      }
    }
    return {
      restored: live,
      preserved: moved.includes(live) ? live + suffix : null,
      createdAt: data.createdAt,
      sessionsRevoked: true,
    };
  } catch (error) {
    // Roll back the entire database/key set if installation fails midway.
    for (const path of installed.reverse()) if (existsSync(path)) unlinkSync(path);
    for (const path of moved.reverse()) renameSync(path + suffix, path);
    throw error;
  } finally {
    for (const path of stages) if (existsSync(path)) unlinkSync(path);
  }
}
