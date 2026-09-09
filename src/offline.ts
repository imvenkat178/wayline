import type { Journey, Ticket } from "./types";
export interface OfflinePack {
  journey: Journey;
  tickets: Ticket[];
  savedAt: string;
  expiresAt: string;
}
interface EncryptedPack {
  id: string;
  salt: number[];
  iv: number[];
  cipher: number[];
  savedAt: string;
  expiresAt: string;
}
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("wayline-offline-v2", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("packs", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function operation<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("packs", mode),
        req = fn(tx.objectStore("packs"));
      let result: T;
      req.onsuccess = () => {
        result = req.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function key(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  if (passphrase.length < 12)
    throw new Error("Use an offline passphrase of at least 12 characters.");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function saveOffline(pack: OfflinePack, passphrase: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const derived = await key(passphrase, salt);
  const bytes = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    derived,
    new TextEncoder().encode(JSON.stringify(pack)),
  );
  await operation("readwrite", (s) =>
    s.put({
      id: pack.journey.id,
      salt: [...salt],
      iv: [...iv],
      cipher: [...new Uint8Array(bytes)],
      savedAt: pack.savedAt,
      expiresAt: pack.expiresAt,
    }),
  );
}
export async function listOffline() {
  const packs = await operation<EncryptedPack[]>("readonly", (s) => s.getAll());
  for (const p of packs)
    if (Date.parse(p.expiresAt) < Date.now()) await operation("readwrite", (s) => s.delete(p.id));
  return packs
    .filter((p) => Date.parse(p.expiresAt) >= Date.now())
    .map(({ id, savedAt, expiresAt }) => ({ id, savedAt, expiresAt }));
}
export async function unlockOffline(id: string, passphrase: string) {
  const pack = await operation<EncryptedPack>("readonly", (s) => s.get(id));
  if (!pack || Date.parse(pack.expiresAt) < Date.now())
    throw new Error("This offline pack has expired.");
  try {
    const derived = await key(passphrase, new Uint8Array(pack.salt));
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(pack.iv) },
      derived,
      new Uint8Array(pack.cipher),
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as OfflinePack;
  } catch {
    throw new Error("Unable to unlock this pack. Check your passphrase.");
  }
}
export async function clearOffline() {
  await operation("readwrite", (s) => s.clear());
}
export async function deleteOffline(id: string) {
  await operation("readwrite", (s) => s.delete(id));
}
