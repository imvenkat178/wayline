import { useEffect, useRef, useState } from "react";
import type { Journey } from "../types";
import { Icon, Button, Badge, modeIcon } from "./ui";
interface Vehicle {
  id: string;
  lat: number;
  lon: number;
  tracking: { source: string; observedAt: string | null };
}
export function JourneyMap({
  journey,
  vehicles,
  compact = false,
}: {
  journey?: Journey | null;
  vehicles?: Vehicle[];
  compact?: boolean;
}) {
  const [geographic, setGeographic] = useState(false);
  const [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!geographic || !host.current) return;
    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;
    void (async () => {
      try {
        const lib = await import("maplibre-gl");
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (cancelled || !host.current) return;
        map = new lib.Map({
          container: host.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap contributors",
              },
            },
            layers: [
              {
                id: "osm",
                type: "raster",
                source: "osm",
                paint: { "raster-saturation": -0.75, "raster-brightness-max": 0.48 },
              },
            ],
          },
          center: journey?.fromCoords ?? [-71.06, 42.35],
          zoom: journey ? 6 : 11,
        });
        map.addControl(new lib.NavigationControl({ showCompass: false }), "bottom-right");
        map.on("error", () =>
          setError("Basemap unavailable. The journey diagram remains available."),
        );
        map.on("load", () => {
          if (!map) return;
          if (journey) {
            new lib.Marker({ color: "#72e5cf" }).setLngLat(journey.fromCoords).addTo(map);
            new lib.Marker({ color: "#f0be79" }).setLngLat(journey.toCoords).addTo(map);
            map.fitBounds([journey.fromCoords, journey.toCoords], { padding: 60, maxZoom: 13 });
          }
          for (const v of vehicles ?? [])
            new lib.Marker({ color: v.tracking.source === "live-gps" ? "#72e5cf" : "#f0be79" })
              .setLngLat([v.lon, v.lat])
              .addTo(map);
        });
      } catch {
        setError("Map could not load. Use the journey diagram.");
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [geographic, journey?.id, vehicles]);
  const stops = journey ? journey.legs.filter((l) => l.mode !== "walk") : [];
  return (
    <div className={`journey-map ${compact ? "compact" : ""}`}>
      <div className="map-toolbar">
        <Badge tone={journey?.dataMode === "illustrative" ? "amber" : "neutral"}>
          {journey?.dataMode === "illustrative"
            ? "SAMPLE JOURNEY"
            : vehicles
              ? "MBTA FEED"
              : "JOURNEY OVERVIEW"}
        </Badge>
        <Button
          icon={geographic ? "route" : "globe"}
          kind="small"
          onClick={() => {
            setError("");
            setGeographic(!geographic);
          }}
        >
          {geographic ? "Diagram" : "Map"}
        </Button>
      </div>
      {geographic ? (
        <div
          ref={host}
          className="map-canvas"
          aria-label="Geographic map of journey endpoints or reported vehicles"
        />
      ) : (
        <div className="route-diagram">
          <div className="diagram-endpoint">
            <span className="terminal-dot" />
            <div>
              <small>DEPARTURE</small>
              <b>{journey?.from ?? "Boston, MA"}</b>
            </div>
          </div>
          <div className="diagram-path">
            <div className="diagram-track" />
            {stops.map((l, i) => (
              <div
                className="diagram-stop"
                key={l.id}
                style={{ left: `${20 + (i * 60) / Math.max(1, stops.length - 1)}%` }}
              >
                <div className={`stop-icon mode-${l.mode}`}>
                  <Icon name={modeIcon(l.mode)} size={24} />
                </div>
                <span>{l.operator}</span>
                <small>{l.service}</small>
              </div>
            ))}
          </div>
          <div className="diagram-endpoint end">
            <span className="terminal-dot destination" />
            <div>
              <small>DESTINATION</small>
              <b>{journey?.to ?? "Live positions"}</b>
            </div>
          </div>
        </div>
      )}
      <div className="map-caption">
        <Icon name="info" size={14} />
        {error ||
          (geographic
            ? "Map shows endpoints; route geometry is not implied."
            : "Connection diagram · not geographic navigation")}
      </div>
    </div>
  );
}
