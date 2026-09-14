import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "./ui";
interface Health {
  services: {
    name: string;
    status: string;
    lastSuccess: string | null;
    ageSeconds?: number;
    coverage?: string;
    reason?: string;
    lastChecked?: string;
  }[];
  backup: { status: string; lastSuccess?: string };
  checking?: boolean;
  lastChecked?: string;
  observedAt?: string;
}
const failureReasons: Record<string, string> = {
  ROUTING_UNAVAILABLE: "The local router could not be reached. Try checking again shortly.",
  ROUTING_TIMEOUT: "The local router is taking too long to respond.",
  OTP_SCHEMA_ERROR: "The router returned an invalid response.",
  FEED_DISABLED: "External travel feeds are disabled.",
};
function ageLabel(seconds: number) {
  if (seconds < 60) return "just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + " min ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + " hr ago";
  return Math.floor(seconds / 86400) + " days ago";
}
export function ServiceStatus() {
  const [health, setHealth] = useState<Health | null>(null),
    [error, setError] = useState(""),
    [checkRequest, setCheckRequest] = useState(0),
    [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let valid = true, pending = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async (check = false) => {
      if (pending || !valid) return;
      pending = true;
      clearTimeout(timer);
      let nextCheck = 30000;
      try {
        const r = await api<Health>(check ? "/travel/check" : "/travel/health", check ? "POST" : "GET");
        if (valid) {
          setHealth(r);
          setError("");
          setRefreshing(!!r.checking);
          if (r.checking) nextCheck = 2000;
        }
      } catch {
        if (valid) {
          setError("Travel status unavailable. Try checking again. Your saved plans remain available.");
          setRefreshing(false);
        }
      } finally {
        pending = false;
        if (valid) timer = setTimeout(() => void load(), nextCheck);
      }
    };
    const resume = () => { if (!document.hidden) void load(); };
    void load(checkRequest > 0);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      valid = false;
      clearTimeout(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [checkRequest]);
  return (
    <details className="travel-health">
      <summary>Boston / MBTA pilot · service connections</summary>
      <div className="service-check-toolbar">
        <p role="status">{refreshing ? "Checking travel services…" : health?.lastChecked
          ? "Last connection check: " + new Date(health.lastChecked).toLocaleString()
          : "Checks run automatically. You can check again at any time."}</p>
        <Button icon="refresh" kind="small" disabled={refreshing} onClick={() => {
          setRefreshing(true);
          setCheckRequest(n => n + 1);
        }}>{refreshing ? "Checking…" : "Check connections"}</Button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="service-status">
        {health?.services.map((s) => (
          <div key={s.name} className={"service-connection " + s.status}>
            <b>{s.name}</b>
            <strong className="service-state">{s.status}</strong>
            <small>
              Last success{" "}
              {s.lastSuccess ? <time dateTime={s.lastSuccess}>{new Date(s.lastSuccess).toLocaleString()}</time> : "not yet checked"}
              {s.ageSeconds != null ? " · " + ageLabel(s.ageSeconds) : ""}
            </small>
            {s.coverage && <small>{s.coverage}</small>}
            {s.status === "unavailable" && <small>{failureReasons[s.reason ?? ""] ?? "The latest provider check failed. Try checking again shortly."}</small>}
          </div>
        ))}
      </div>
      <p className="fine-print">Connection checks reuse feed caches while valid. Timestamps show when data was actually received.</p>
      {health && (
        <p className="fine-print">
          Encrypted backups: {health.backup.status}
          {health.backup.lastSuccess
            ? " · " + new Date(health.backup.lastSuccess).toLocaleString()
            : ""}
          . Stored locally unless an external destination is configured.
        </p>
      )}
    </details>
  );
}
