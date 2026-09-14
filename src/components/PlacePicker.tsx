import { useEffect, useId, useState } from "react";
import type { Place } from "../types";
import { api } from "../api";
export function PlacePicker({
  value,
  place,
  onChange,
  label,
}: {
  value: string;
  place?: Place;
  onChange: (value: string, place?: Place) => void;
  label: string;
}) {
  const [query, setQuery] = useState(
    place?.name ?? { "place-sstat": "South Station", "place-harsq": "Harvard" }[value] ?? value,
  );
  const [options, setOptions] = useState<Place[]>([]),
    [active, setActive] = useState(-1),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    setQuery(
      place?.name ?? { "place-sstat": "South Station", "place-harsq": "Harvard" }[value] ?? value,
    );
  }, [value, place?.name]);
  useEffect(() => {
    if (!open) return;
    let valid = true;
    const timer = setTimeout(() => {
      void api<{ places: Place[] }>("/places?q=" + encodeURIComponent(query))
        .then((r) => {
          if (valid) {
            setOptions(r.places.slice(0, 8));
            setError("");
          }
        })
        .catch((e) => {
          if (valid) {
            setOptions([]);
            setError(e.message);
          }
        });
    }, 250);
    return () => {
      valid = false;
      clearTimeout(timer);
    };
  }, [query, open]);
  const coordinates = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  const point = coordinates
    ? {
        id: "coordinate:" + coordinates[1] + "," + coordinates[2],
        name: query,
        lat: Number(coordinates[1]),
        lon: Number(coordinates[2]),
        timezone: "America/New_York",
      }
    : null;
  const choices = [...(point && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180 ? [point] : []), ...options];
  const choose = (p: Place) => {
    onChange(p.id, p);
    setQuery(p.name);
    setOpen(false);
  };
  return (
    <div className="place-picker">
      <input
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 && choices[active] ? `${id}-${active}` : undefined}
        role="combobox"
        value={query}
        placeholder="Station or latitude, longitude"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(-1);
          setOptions([]);
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault(); setOpen(true);
            setActive(i => choices.length ? i < 0 ? (e.key === "ArrowDown" ? 0 : choices.length - 1) : (i + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length : -1);
          }
          if (e.key === "Enter" && open && active >= 0 && choices[active]) {
            e.preventDefault(); choose(choices[active]); setActive(-1);
          }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="place-options" id={id} role="listbox" aria-label="Boston stations">
          {choices.map((p, index) => (
            <button
              type="button"
              key={p.id}
              id={`${id}-${index}`}
              role="option"
              aria-selected={active === index || value === p.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(p)}
            >
              <b>{p.name}</b>
              <small>{p.id.startsWith("coordinate:") ? "Use these coordinates" : "MBTA · Boston area"}</small>
            </button>
          ))}
          {!choices.length && <small role="status">{error || "Type a Boston station name"}</small>}
        </div>
      )}
    </div>
  );
}
