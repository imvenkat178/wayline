import { useContext, useEffect, useRef, useState } from "react";
import type { Journey } from "../types";
import { AppContext } from "../context";
import { Button, Badge, Icon } from "./ui";
import { journeyBounds, legGeometry } from "../geometry";
import { journeyMapStyle, mapTileRequest } from "../mapStyle";
import { loadMapLibre } from "../mapRuntime";
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
  offline = false,
  selectedLeg,
  onLegSelect,
}: {
  journey?: Journey | null;
  vehicles?: Vehicle[];
  compact?: boolean;
  offline?: boolean;
  selectedLeg?: string | null;
  onLegSelect?: (id: string) => void;
}) {
  const [geographic, setGeographic] = useState(!offline),
    [error, setError] = useState(""),
    [tilted, setTilted] = useState(false);
  const host = useRef<HTMLDivElement>(null),
    mapRef = useRef<import("maplibre-gl").Map | null>(null),
    selectRef = useRef(onLegSelect);
  selectRef.current = onLegSelect;
  const selectedRef = useRef(selectedLeg);
  selectedRef.current = selectedLeg;
  // A configured vector style (MAP_STYLE_URL) replaces the default OpenStreetMap raster style.
  const styleUrl = useContext(AppContext)?.boot?.mapStyleUrl ?? null;
  useEffect(() => {
    if (!geographic || offline || !host.current) return;
    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;
    let observer: ResizeObserver | undefined;
    void (async () => {
      try {
        const lib = await loadMapLibre();
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (cancelled || !host.current) return;
        map = new lib.Map({
          container: host.current,
          style: styleUrl ?? journeyMapStyle(),
          transformRequest: mapTileRequest,
          attributionControl: { compact: false },
          center: journey?.fromCoords ?? [-71.06, 42.35],
          zoom: 11,
        });
        mapRef.current = map;
        observer = new ResizeObserver(() => map?.resize());
        observer.observe(host.current);
        map.addControl(new lib.NavigationControl({ showCompass: false }), "bottom-right");
        map.addControl(new lib.FullscreenControl(), "bottom-right");
        map.on("error", (event) => {
          if (cancelled) return;
          if ("sourceId" in event && event.sourceId === "osm") {
            setError("Street map unavailable. Your route is shown below. Retry the map when your connection returns.");
            setGeographic(false);
          } else {
            setError("Some map details could not load. You can still open the route diagram.");
          }
        });
        // Route overlays should not depend on a remote tile request completing.
        map.once("style.load", () => {
          if (!map || cancelled) return;
          if (journey) {
            const features = journey.legs.map((l) => ({
              type: "Feature" as const,
              properties: { id: l.id, walk: l.mode === "walk", approximate: !l.geometry },
              geometry: { type: "LineString" as const, coordinates: legGeometry(l, journey) },
            }));
            map.addSource("route", {
              type: "geojson",
              data: { type: "FeatureCollection", features },
            });
            map.addLayer({
              id: "route-outline",
              type: "line",
              source: "route",
              layout: { "line-cap": "round", "line-join": "round" },
              paint: { "line-color": "#fffaf4", "line-width": 10, "line-opacity": 0.95 },
            });
            map.addLayer({
              id: "transit",
              type: "line",
              source: "route",
              filter: ["==", ["get", "walk"], false],
              layout: { "line-cap": "round", "line-join": "round" },
              paint: { "line-color": "#b8421e", "line-width": 6 },
            });
            map.addLayer({
              id: "walking",
              type: "line",
              source: "route",
              filter: ["==", ["get", "walk"], true],
              paint: { "line-color": "#1f6974", "line-width": 4, "line-dasharray": [1, 1] },
            });
            map.addLayer({
              id: "selected",
              type: "line",
              source: "route",
              filter: ["==", ["get", "id"], selectedRef.current ?? ""],
              paint: { "line-color": "#08606e", "line-width": 8, "line-opacity": 0.7 },
            });
            const stops = new Set<string>();
            for (const leg of journey.legs) {
              for (const [name, coords, stopId] of [
                [leg.from, leg.fromCoords, leg.fromStopId],
                [leg.to, leg.toCoords, leg.toStopId],
              ] as const) {
                if (!coords) continue;
                const key = stopId ?? coords.join(",");
                if (stops.has(key)) continue;
                stops.add(key);
                const button = document.createElement("button");
                button.className = "app-map-marker";
                button.type = "button";
                button.textContent = String(stops.size);
                button.setAttribute("aria-label", name + " stop");
                button.addEventListener("click", () => selectRef.current?.(leg.id));
                const body = document.createElement("div");
                const title = document.createElement("strong");
                title.textContent = name;
                const text = document.createElement("p");
                text.textContent =
                  leg.service + (leg.platform ? " · Platform " + leg.platform : "");
                body.append(title, text);
                new lib.Marker({ element: button })
                  .setLngLat(coords)
                  .setPopup(new lib.Popup({ offset: 18 }).setDOMContent(body))
                  .addTo(map);
              }
            }
            for (const layer of ["transit", "walking"]) {
              map.on("click", layer, (e) => {
                const id = e.features?.[0]?.properties?.id;
                if (typeof id === "string") selectRef.current?.(id);
              });
              map.on("mouseenter", layer, () => {
                if (map) map.getCanvas().style.cursor = "pointer";
              });
              map.on("mouseleave", layer, () => {
                if (map) map.getCanvas().style.cursor = "";
              });
            }
            map.fitBounds(journeyBounds(journey), { padding: 48, maxZoom: 14, duration: 0 });
          }
          const matched =
            vehicles ??
            journey?.legs
              .filter((l) => l.tracking.position && l.tracking.source === "live-gps")
              .map((l) => ({
                id: l.id,
                lon: l.tracking.position![0],
                lat: l.tracking.position![1],
                tracking: l.tracking,
              })) ??
            [];
          // Vehicles render from one clustered GeoJSON source (ROADMAP G11.4). A feed can list
          // hundreds of vehicles, and a DOM marker per vehicle made the map slow to pan and zoom.
          if (matched.length) {
            const now = Date.now();
            map.addSource("vehicles", {
              type: "geojson",
              cluster: true,
              clusterRadius: 40,
              clusterMaxZoom: 14,
              data: {
                type: "FeatureCollection",
                features: matched.map((v) => ({
                  type: "Feature" as const,
                  properties: {
                    stale: !v.tracking.observedAt || now - Date.parse(v.tracking.observedAt) > 120000,
                    observedAt: v.tracking.observedAt ?? "",
                  },
                  geometry: { type: "Point" as const, coordinates: [v.lon, v.lat] },
                })),
              },
            });
            map.addLayer({
              id: "vehicle-clusters",
              type: "circle",
              source: "vehicles",
              filter: ["has", "point_count"],
              paint: {
                "circle-color": "#087466",
                "circle-opacity": 0.85,
                "circle-stroke-color": "#fffaf4",
                "circle-stroke-width": 2,
                "circle-radius": ["step", ["get", "point_count"], 12, 10, 16, 50, 22],
              },
            });
            map.addLayer({
              id: "vehicle-points",
              type: "circle",
              source: "vehicles",
              filter: ["!", ["has", "point_count"]],
              paint: {
                "circle-color": ["case", ["get", "stale"], "#9f967f", "#087466"],
                "circle-radius": 6,
                "circle-stroke-color": "#fffaf4",
                "circle-stroke-width": 2,
              },
            });
            map.on("click", "vehicle-clusters", (e) => {
              const feature = e.features?.[0];
              const source = map?.getSource("vehicles") as import("maplibre-gl").GeoJSONSource | undefined;
              if (!feature || !source || !map) return;
              const center = (feature.geometry as { coordinates: [number, number] }).coordinates;
              void source
                .getClusterExpansionZoom(feature.properties.cluster_id)
                .then((zoom) => map?.easeTo({ center, zoom }));
            });
            map.on("click", "vehicle-points", (e) => {
              const feature = e.features?.[0];
              if (!feature || !map) return;
              const { stale, observedAt } = feature.properties as { stale: boolean; observedAt: string };
              const text = document.createElement("div");
              text.textContent =
                (stale ? "Last observed vehicle" : "Live vehicle") +
                " · " +
                (observedAt ? new Date(observedAt).toLocaleTimeString() : "time unknown");
              new lib.Popup()
                .setLngLat((feature.geometry as { coordinates: [number, number] }).coordinates)
                .setDOMContent(text)
                .addTo(map);
            });
            for (const layer of ["vehicle-clusters", "vehicle-points"]) {
              map.on("mouseenter", layer, () => {
                if (map) map.getCanvas().style.cursor = "pointer";
              });
              map.on("mouseleave", layer, () => {
                if (map) map.getCanvas().style.cursor = "";
              });
            }
          }
        });
      } catch {
        if (!cancelled) {
          setError("Street map could not load. Your route is shown below.");
          setGeographic(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      map?.remove();
      mapRef.current = null;
    };
  }, [geographic, offline, journey, vehicles, styleUrl]);
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("selected"))
      map.setFilter("selected", ["==", ["get", "id"], selectedLeg ?? ""]);
  }, [selectedLeg]);
  const actual = journey?.legs.every((l) => !!l.geometry);
  return (
    <div className={"journey-map " + (compact ? "compact" : "")}>
      <div className="map-toolbar">
        <Badge tone={journey?.dataMode === "illustrative" ? "amber" : "neutral"}>
          {offline
            ? "OFFLINE GEOMETRY"
            : journey?.dataMode === "illustrative"
              ? "SAMPLE JOURNEY"
              : actual
                ? "MBTA ROUTE"
                : "JOURNEY OVERVIEW"}
        </Badge>
        {!offline && (
          <Button
            kind="small"
            onClick={() => {
              setGeographic(!geographic);
              setError("");
              setTilted(false);
            }}
          >
            {geographic ? "Diagram" : error ? "Retry map" : "Map"}
          </Button>
        )}
      </div>
      {geographic && !offline ? (
        <div
          ref={host}
          className="map-canvas"
          aria-label="Interactive route map with walking legs, stops and matched vehicles"
        />
      ) : journey ? (
        <GeometryDiagram journey={journey} selectedLeg={selectedLeg} onSelect={onLegSelect} />
      ) : (
        <p>Select a journey to view its route.</p>
      )}
      {geographic && !offline && (
        <div className="app-map-controls">
          <Button
            kind="small"
            onClick={() => {
              const next = !tilted;
              setTilted(next);
              mapRef.current?.easeTo({ pitch: next ? 45 : 0, bearing: next ? -12 : 0 });
            }}
          >
            {tilted ? "2D view" : "Tilt map"}
          </Button>
          {journey && (
            <Button
              kind="small"
              onClick={() =>
                mapRef.current?.fitBounds(journeyBounds(journey), { padding: 48, maxZoom: 14 })
              }
            >
              Fit journey
            </Button>
          )}
        </div>
      )}
      <div className="map-caption">
        <Icon name="info" size={14} />
        {error ||
          (actual
            ? "Solid: transit · dotted: walking · select a route or stop"
            : journey?.dataMode === "illustrative"
              ? "Sample route; connections are approximate."
              : "Approximate connections where geometry is unavailable.")}
      </div>
    </div>
  );
}
function GeometryDiagram({
  journey: j,
  selectedLeg,
  onSelect,
}: {
  journey: Journey;
  selectedLeg?: string | null;
  onSelect?: (id: string) => void;
}) {
  const bounds = journeyBounds(j),
    w = Math.max(0.001, bounds[1][0] - bounds[0][0]),
    h = Math.max(0.001, bounds[1][1] - bounds[0][1]);
  const point = (p: [number, number]) => [
    ((p[0] - bounds[0][0]) / w) * 480 + 30,
    270 - ((p[1] - bounds[0][1]) / h) * 240,
  ];
  return (
    <div className="geometry-diagram">
      <svg
        viewBox="0 0 540 300"
        role="img"
        aria-label="Saved route geometry; basemap tiles are not downloaded"
      >
        {j.legs.map((l) => (
          <polyline
            key={l.id}
            role="button"
            tabIndex={0}
            aria-label={l.service + " " + l.from + " to " + l.to}
            onClick={() => onSelect?.(l.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelect?.(l.id);
            }}
            points={legGeometry(l, j)
              .map((p) => point(p).join(","))
              .join(" ")}
            fill="none"
            stroke={selectedLeg === l.id ? "#0b706e" : l.mode === "walk" ? "#638d98" : "#bd512a"}
            strokeWidth={selectedLeg === l.id ? 7 : 4}
            strokeDasharray={l.mode === "walk" ? "5 4" : undefined}
          />
        ))}
        {[j.fromCoords, j.toCoords].map((p, i) => (
          <g key={i}>
            <circle cx={point(p)[0]} cy={point(p)[1]} r="10" fill="#173f4a" />
            <text
              x={point(p)[0]}
              y={point(p)[1] + 4}
              textAnchor="middle"
              fontSize="10"
              fill="white"
            >
              {i ? "B" : "A"}
            </text>
          </g>
        ))}
      </svg>
      <p>
        A · {j.from} <span>B · {j.to}</span>
      </p>
    </div>
  );
}
