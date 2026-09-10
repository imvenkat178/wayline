// R08: lets the app ask the active service worker (public/sw.js) whether THIS build's app shell
// has actually finished precaching -- not just "a service worker is registered," which can be
// true well before install() has completed, or even after it failed and fell back to caching
// only the static SHELL_URLS. Used by Journey.tsx's offline-pack save flow so its confirmation
// reflects what's really saved: the encrypted journey pack (IndexedDB, src/offline.ts) is a
// separate mechanism from the app shell (CacheStorage) that has to boot before that pack can
// ever be opened, and before this fix nothing checked the second half before promising it works.
export async function shellReady(timeoutMs = 4000): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const worker = registration?.active;
  if (!worker) return false;
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      resolve(Boolean(event.data?.ready));
    };
    worker.postMessage({ type: "SHELL_STATUS" }, [channel.port2]);
  });
}
