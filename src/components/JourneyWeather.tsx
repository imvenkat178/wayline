import { useEffect, useState } from "react";
import { api } from "../api";
import { Button, Notice, Section } from "./ui";
import type { Journey } from "../types";
interface Forecast {
  source: string; fetchedAt: string; cache: string;
  periods: { name: string; startTime: string; endTime: string; temperature: number; temperatureUnit: string; shortForecast: string; windSpeed: string }[];
  alerts: { id: string; headline: string; effective?: string; expires?: string }[];
}
export function JourneyWeather({ journey }: { journey: Journey }) {
  const [data, setData] = useState<Forecast | null>(null), [error, setError] = useState(""), [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (journey.dataMode !== "provider") return;
    let valid = true;
    setBusy(true); setData(null); setError("");
    void api<Forecast>(`/journeys/${journey.id}/weather`).then(value => { if (valid) setData(value); })
      .catch(() => { if (valid) setError("Weather is unavailable. Refresh to try again."); })
      .finally(() => { if (valid) setBusy(false); });
    return () => { valid = false; };
  }, [journey.id, journey.version, journey.dataMode, refresh]);
  if (journey.dataMode !== "provider") return null;
  const departure = Date.parse(journey.departure), arrival = Date.parse(journey.arrival);
  const period = data?.periods.find(p => Date.parse(p.startTime) <= departure && Date.parse(p.endTime) > departure);
  const alerts = data?.alerts.filter(a => (!a.effective || Date.parse(a.effective) <= arrival) && (!a.expires || Date.parse(a.expires) >= departure)) ?? [];
  return <Section title="Weather at departure" action={<Button kind="small" disabled={busy} onClick={() => setRefresh(n => n + 1)}>Refresh</Button>}>
    {busy && <p role="status">Checking the National Weather Service…</p>}
    {error && <Notice tone="amber">{error}</Notice>}
    {period ? <><h3>{period.temperature}°{period.temperatureUnit} · {period.shortForecast}</h3><p>{journey.from} · Wind {period.windSpeed}</p></> : data && <p>No forecast covers this departure yet.</p>}
    {alerts.map(a => <Notice tone="amber" key={a.id}>{a.headline}</Notice>)}
    {data && <p className="fine-print">{data.source} · {data.cache === "stale" ? "Stale data · " : ""}checked {new Date(data.fetchedAt).toLocaleString()}. Forecasts do not confirm service cancellations.</p>}
  </Section>;
}
