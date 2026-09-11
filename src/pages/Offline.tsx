import { useEffect, useState } from "react";
import {
  lockOffline,
  listOffline,
  unlockOffline,
  deleteOffline,
  type OfflinePack,
} from "../offline";
import { Button, Field, Notice, Empty, Section, useAsync } from "../components/ui";
import { time, dateLabel } from "../api";
import { JourneyMap } from "../components/JourneyMap";
export default function Offline() {
  const [packs, setPacks] = useState<Awaited<ReturnType<typeof listOffline>>>([]),
    [unlocked, setUnlocked] = useState<OfflinePack | null>(null),
    [pass, setPass] = useState(""),
    [selected, setSelected] = useState("");
  const { busy, error, run } = useAsync();
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let mounted = true;
    void listOffline()
      .then((data) => {
        if (mounted) {
          setPacks(data);
          setSelected(data[0]?.id ?? "");
        }
      })
      .catch(() => {
        if (mounted) setLoadError("Could not open local encrypted packs on this browser.");
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (!unlocked) return;
    const id = setTimeout(() => {
      lockOffline();
      setUnlocked(null);
    }, 300000);
    return () => clearTimeout(id);
  }, [unlocked]);
  useEffect(() => () => lockOffline(), []);
  return (
    <div className="offline-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">STILL WITH YOU</span>
          <h1>Your offline journey</h1>
          <p>Encrypted on this device. Ready without a connection.</p>
        </div>
        <Button
          onClick={() => {
            location.href = "/";
          }}
        >
          Return to Wayline
        </Button>
      </div>
      <Notice>
        Offline information is a snapshot. Live updates, new routes and purchases require a
        connection.
      </Notice>
      {(error || loadError) && <Notice tone="error">{error || loadError}</Notice>}
      {unlocked ? (
        <>
          <Section
            title={`${unlocked.journey.from} → ${unlocked.journey.to}`}
            action={
              <Button
                onClick={() => {
                  lockOffline();
                  setUnlocked(null);
                }}
              >
                Lock pack
              </Button>
            }
          >
            <p>
              {dateLabel(unlocked.journey.departure, unlocked.journey.timezone)} ·{" "}
              {time(unlocked.journey.departure, unlocked.journey.timezone)}
            </p>
            <Notice>
              Saved {new Date(unlocked.savedAt).toLocaleString()} ·{" "}
              {unlocked.journey.dataMode === "illustrative"
                ? "Sample itinerary"
                : "Provider schedule"}{" "}
              · Auto-locks after 5 minutes.
            </Notice>
            <JourneyMap journey={unlocked.journey} offline />
            <div className="mini-timeline">
              {unlocked.journey.legs.map((l) => (
                <div key={l.id}>
                  <div>
                    <b>{l.service}</b>
                    <p>
                      {l.from} → {l.to}
                    </p>
                    <small>{l.boardingHint}</small>
                  </div>
                  <span>{time(l.departure, unlocked.journey.timezone)}</span>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Saved ticket details">
            {unlocked.tickets.map((t) => (
              <div className="saved-item" key={t.id}>
                <div>
                  <b>
                    {t.operator} · {t.service}
                  </b>
                  <p>
                    {t.passenger} · {t.confirmation}
                  </p>
                  <small>
                    {t.origin} → {t.destination} · Seat {t.seat || "unassigned"} · Coach{" "}
                    {t.coach || "unassigned"}
                  </small>
                  {t.barcodeText && <p>Imported reference: {t.barcodeText}</p>}
                  {t.document && (
                    <img
                      className="offline-ticket-image"
                      src={"data:" + t.document.type + ";base64," + t.document.base64}
                      alt={"Imported ticket: " + t.document.name}
                    />
                  )}
                </div>
              </div>
            ))}
            {!unlocked.tickets.length && <p>No ticket details were included in this pack.</p>}
          </Section>
        </>
      ) : packs.length ? (
        <Section title="Unlock a saved pack">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                setUnlocked(await unlockOffline(selected, pass));
                setPass("");
              });
            }}
          >
            <Field label="Offline pack">
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                {packs.map((p, i) => (
                  <option key={p.id} value={p.id}>
                    Pack {i + 1} · saved {new Date(p.savedAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Your offline passphrase">
              <input
                type="password"
                required
                minLength={12}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <div className="button-row">
              <Button kind="primary" type="submit" disabled={busy}>
                Unlock pack
              </Button>
              <Button
                kind="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await deleteOffline(selected);
                    const data = await listOffline();
                    setPacks(data);
                    setSelected(data[0]?.id ?? "");
                  })
                }
              >
                Remove pack
              </Button>
            </div>
          </form>
        </Section>
      ) : (
        <Empty icon="lock" title="No offline packs on this browser">
          Open a saved journey while connected and choose Offline pack.
        </Empty>
      )}
    </div>
  );
}
