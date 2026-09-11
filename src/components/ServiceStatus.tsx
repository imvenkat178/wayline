import { useEffect, useState } from "react";
import { api } from "../api";
interface Health {
  services: {
    name: string;
    status: string;
    lastSuccess: string | null;
    ageSeconds?: number;
    coverage?: string;
  }[];
  backup: { status: string; lastSuccess?: string };
}
export function ServiceStatus() {
  const [health, setHealth] = useState<Health | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let valid = true;
    const load = () =>
      void api<Health>("/travel/health")
        .then((r) => {
          if (valid) {
            setHealth(r);
            setError("");
          }
        })
        .catch(() => {
          if (valid) setError("Travel status unavailable. Your saved plans remain available.");
        });
    load();
    const timer = setInterval(load, 30000);
    return () => {
      valid = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <details className="travel-health">
      <summary>Boston / MBTA pilot · service connections</summary>
      {error && <p>{error}</p>}
      <div className="service-status">
        {health?.services.map((s) => (
          <span key={s.name} className={s.status}>
            <b>{s.name}</b> · {s.status}
            <small style={{ display: "block" }}>
              Last success{" "}
              {s.lastSuccess ? new Date(s.lastSuccess).toLocaleTimeString() : "not yet checked"}
              {s.ageSeconds != null ? " · " + s.ageSeconds + "s ago" : ""}
            </small>
            {s.coverage && <small style={{ display: "block" }}>{s.coverage}</small>}
          </span>
        ))}
      </div>
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
