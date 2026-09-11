import type { Journey } from "../types";
import { money, time, duration } from "../api";
import { Icon, Badge, modeIcon } from "./ui";

export function JourneyCard({ journey: j, selected, onSelect, rank }: {
  journey: Journey; selected: boolean; onSelect: () => void; rank: number;
}) {
  return (
    <button className={`journey-card ${selected ? "selected" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <div className="journey-card-top">
        <Badge tone={rank === 0 ? "mint" : j.graph.overallRisk === "high" ? "amber" : ""}>
          {rank === 0 ? <><Icon name="check" size={14} /> Recommended</> : j.name}
        </Badge>
        <span className="route-selection">
          {selected ? "Selected" : "View route"}
          <span className={`selection-indicator ${selected ? "checked" : ""}`}>{selected && <Icon name="check" size={11} />}</span>
        </span>
      </div>
      <div className="journey-card-body">
        <div className="journey-card-main">
          <div className="times">
            <strong>{time(j.departure, j.timezone)}</strong>
            <div className="duration-line"><small>{duration(j.durationMinutes)}</small><span /></div>
            <strong>{time(j.arrival, j.destinationTimezone)}</strong>
          </div>
          <div className="station-names"><span>{j.from}</span><span>{j.to}</span></div>
          <div className="mode-strip">
            {j.legs.filter((l) => l.mode !== "walk").map((l, i) => (
              <span key={l.id}>
                {i > 0 && <Icon name="chevron" size={12} />}
                <i className={`mode-pill mode-${l.mode}`}><Icon name={modeIcon(l.mode)} size={14} />{l.operator}</i>
              </span>
            ))}
          </div>
        </div>
        <span className="card-price">{money(j.price.totalCents)}<small>{j.travelers > 1 ? `${j.travelers} travelers total` : "total estimate"}</small></span>
      </div>
      <div className="journey-card-foot">
        <span><Icon name="shield" size={14} />{j.graph.overallRisk === "low" ? "Generous connection" : j.graph.overallRisk === "high" ? "Tight connection" : "Moderate buffer"}</span>
        <span><Icon name="walk" size={14} />{j.walkMinutes} min walk</span>
        <span>{j.transfers} transfer{j.transfers === 1 ? "" : "s"}</span>
      </div>
    </button>
  );
}
