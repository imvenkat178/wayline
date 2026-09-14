import { useApp } from "../context";
import type { Place } from "../types";
import { Field } from "./ui";
import { PlacePicker } from "./PlacePicker";

export interface SavedRouteDraft { mode: "sample" | "provider"; from: string; to: string; fromPlace?: Place; toPlace?: Place }
export function initialSavedRoute(pilot = false): SavedRouteDraft {
  return pilot ? { mode: "provider", from: "place-sstat", to: "place-harsq" } : { mode: "sample", from: "la", to: "sj" };
}
export function SavedRouteFields({ value, onChange }: { value: SavedRouteDraft; onChange: (v: SavedRouteDraft) => void }) {
  const { boot } = useApp();
  return <>
    <Field label="Schedule source"><select value={value.mode} onChange={e => onChange(initialSavedRoute(e.target.value === "provider"))}>
      <option value="provider">Boston / MBTA schedules</option><option value="sample">Sample city routes</option>
    </select></Field>
    <div className="form-grid">
      {(["from", "to"] as const).map(key => <Field key={key} label={key === "from" ? "From" : "To"}>
        {value.mode === "provider" ? <PlacePicker label={key === "from" ? "Departure station" : "Arrival station"}
          value={value[key]} place={value[`${key}Place`]} onChange={(v, p) => onChange({ ...value, [key]: v, [`${key}Place`]: p })} />
          : <select value={value[key]} onChange={e => onChange({ ...value, [key]: e.target.value })}>
            {boot.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>}
      </Field>)}
    </div>
  </>;
}
