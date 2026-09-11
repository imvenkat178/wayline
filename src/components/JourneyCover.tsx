import type { Journey } from "../types";
import { Icon, Button, Badge } from "./ui";
import { time, dateLabel, duration, money, readable } from "../api";
import { JourneyMap } from "./JourneyMap";

export function JourneyCover({ journey: j, compact = false }: { journey: Journey; compact?: boolean }) {
  const boston = j.dataMode==='provider' && j.timezone==='America/New_York';
  const washington = /washington|\bdc\b/i.test(j.to);
  return (
    <div className={`journey-cover ${compact ? "compact-cover" : ""}`}>
      <div className="journey-cover-title">
        <span>{compact ? "ROUTE OVERVIEW" : "SAVED ITINERARY"}</span>
        <h2>{j.from}<span className="sr-only"> to </span><Icon name="arrow" size={15} />{j.to}</h2>
        <small>{dateLabel(j.departure, j.timezone)}</small>
      </div>
      <img src={boston ? "/images/coastal-adventure.png" : washington ? "/images/washington-capitol.jpg" : "/images/coastal-rail.jpg"}
        alt={boston ? "Wayline coastal travel illustration" : washington ? "United States Capitol in Washington, D.C." : "Travel photography: a Pacific Surfliner train on the California coast"}
        title={boston ? "Wayline travel workspace" : washington ? "Washington, D.C. · Photo via Unsplash" : "California coast · Pacific Surfliner"} />
    </div>
  );
}

export function SavedJourneyFeature({ journey: j, open, assistant }: { journey: Journey; open: () => void; assistant: () => void }) {
  return (
    <div className="saved-journey-feature">
      <article className="saved-feature-card">
        <JourneyCover journey={j} />
        <div className="saved-feature-details">
          <div className="section-title">
            <span><Icon name="user" size={15} />{j.travelers} traveler{j.travelers !== 1 ? "s" : ""}</span>
            <div className="button-row"><Badge tone={j.state === "CANCELLED" ? "amber" : ""}>{readable(j.state ?? "planned")}</Badge>{j.dataMode === "illustrative" && <Badge tone="amber">Sample journey</Badge>}</div>
          </div>
          <div className="saved-feature-times">
            <div><small>{j.from}</small><strong>{time(j.departure, j.timezone)}</strong></div>
            <span><small>{duration(j.durationMinutes)}</small><Icon name="train" size={20} /><small>{j.transfers} transfer{j.transfers !== 1 ? "s" : ""}</small></span>
            <div><small>{j.to}</small><strong>{time(j.arrival, j.destinationTimezone)}</strong></div>
          </div>
          <div className="saved-feature-footer"><span>{money(j.price.totalCents)} <small>estimated total</small></span><Button kind="primary" icon="arrow" onClick={open}>View itinerary</Button></div>
        </div>
      </article>
      <aside>
        <section className="panel"><span className="guardian-orb"><Icon name="shield" size={19} /></span><h2>Journey protection</h2><p>Review connections, alternate routes and travel updates.</p><Button icon="arrow" onClick={open}>Open Guardian</Button></section>
        <JourneyMap journey={j} />
        <button className="assistant-inline-link" onClick={assistant}><Icon name="spark" /><span><b>Ask about this journey</b><small>Continue in Wayline Assistant</small></span><Icon name="arrow" size={17} /></button>
      </aside>
    </div>
  );
}
