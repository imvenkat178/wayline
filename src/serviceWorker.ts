// R08: lets the app ask the active service worker (public/sw.js) whether THIS build's app shell
// has actually finished precaching -- not just "a service worker is registered," which can be
// true well before install() has completed, or even after it failed and fell back to caching
// only the static SHELL_URLS. Used by Journey.tsx's offline-pack save flow so its confirmation
// reflects what's really saved: the encrypted journey pack (IndexedDB, src/offline.ts) is a
// separate mechanism from the app shell (CacheStorage) that has to boot before that pack can
// ever be opened, and before this fix nothing checked the second half before promising it works.
export async function readyRegistration(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  const registration = await Promise.race([
    navigator.serviceWorker.ready.catch(() => null),
    new Promise<null>((resolve) => {
      readyTimer = setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
  clearTimeout(readyTimer);
  return registration;
}

export async function shellReady(timeoutMs = 4000): Promise<boolean> {
  const registration = await readyRegistration(timeoutMs);
  const worker = registration?.active;
  if (!worker) return false;
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent) => {
      finish(Boolean(event.data?.ready));
    };
    worker.postMessage({ type: "SHELL_STATUS" }, [channel.port2]);
  });
}
