import { useEffect, useRef, useState } from "react";
import { useApp } from "../context";
import { api } from "../api";
import type { AgentResult, AgentToolResult, PendingAction } from "../types";
import { Modal, Icon, Button, Badge, Notice, useAsync } from "./ui";
import { ActionReview, RouteSummary, RecoveryOptions } from "./TripActions";
export function Agent({
  initialPrompt,
  close,
  inline = false,
}: {
  initialPrompt: string;
  close: () => void;
  inline?: boolean;
}) {
  const { active, result, applyParsed, boot, notify, journeys, setActive, navigate } = useApp();
  const [messages, setMessages] = useState<AgentResult[]>([]),
    [input, setInput] = useState(initialPrompt),
    [voice, setVoice] = useState(false);
  const { busy, error, run } = useAsync();
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setInput(initialPrompt);
  }, [initialPrompt]);
  const recognition = useRef<{ stop: () => void } | null>(null);
  useEffect(() => {
    void api<AgentResult[]>("/agent/history")
      .then(setMessages)
      .catch(() => {});
    return () => recognition.current?.stop();
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  const send = (text?: string, command?: string) =>
    run(async () => {
      const query = (text ?? input).trim();
      if (!query) return;

      const context = active?.version
        ? { journeyId: active.id }
        : result
          ? { searchId: result.searchId, candidateId: active?.id ?? result.journeys[0]?.id }
          : {};
      const reply = await api<AgentResult>("/agent", "POST", { input: query, command, ...context });
      setMessages((m) => [...m, { ...reply, input: query }]);
      setInput("");
    });
  const listen = () => {
    const host = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognizer;
      webkitSpeechRecognition?: new () => SpeechRecognizer;
    };
    const Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Constructor) {
      notify("Voice input is not supported here. Type your question instead.");
      return;
    }
    const r = new Constructor();
    recognition.current = r;
    r.lang =
      boot.user.preferences.language === "es"
        ? "es-US"
        : boot.user.preferences.language === "hi"
          ? "hi-IN"
          : "en-US";
    r.onresult = (e) => {
      setInput(e.results[0][0].transcript);
      setVoice(false);
    };
    r.onerror = () => {
      setVoice(false);
      notify("Voice input could not start. Check microphone permission.");
    };
    r.onend = () => setVoice(false);
    r.start();
    setVoice(true);
  };
  const content = (
    <div className="agent-panel-body">
      <div className="agent-context">
        <span className="guardian-orb">
          <Icon name="spark" />
        </span>
        <div>
          <b>Wayline Assistant</b>
          <small>{active ? `${active.from} → ${active.to}` : "Travel planning"}</small>
        </div>
        <Badge>Plan & manage</Badge>
      </div>
      {journeys.length > 0 && (
        <label className="agent-journey-picker">
          Working on
          <select
            aria-label="Assistant journey"
            value={active?.version ? active.id : ""}
            onChange={(e) => setActive(journeys.find((j) => j.id === e.target.value) ?? null)}
          >
            <option value="">New journey</option>
            {journeys.map((j) => (
              <option key={j.id} value={j.id}>
                {j.from} → {j.to} · {j.state}
              </option>
            ))}
          </select>
        </label>
      )}
      <div
        className="agent-messages"
        role="log"
        aria-label="Assistant conversation"
        aria-live="polite"
      >
        {!messages.length && (
          <div className="assistant-welcome">
            <h3>How can I help with your trip?</h3>
            <p>
              Find a route from South Station to Harvard tomorrow, manage a saved trip, or prepare
              alternatives.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <div className="message user-message">{m.input}</div>
            <div className="message assistant-message">
              <div className="section-title">
                <span className="agent-response-label" title={m.mode}>
                  <Icon name="spark" size={14} />{" "}
                  {m.mode.toLowerCase().includes("rule") ? "Journey guidance" : "Wayline Assistant"}
                </span>
                <Button
                  icon="headphones"
                  kind="icon-only small"
                  title="Read response aloud"
                  onClick={() => {
                    if (!("speechSynthesis" in window)) {
                      notify("Speech output is unavailable.");
                      return;
                    }
                    speechSynthesis.cancel();
                    const speech = new SpeechSynthesisUtterance(m.reply);
                    speech.lang = "en-US";
                    speechSynthesis.speak(speech);
                  }}
                />
              </div>
              <p>{m.reply}</p>
              {m.pendingActions?.map((a) => (
                <ActionReview key={a.id} action={a} />
              ))}
              {m.results?.map((r, n) => (
                <ToolResult key={n} result={r} />
              ))}
              {m.evidence?.map((e, n) => {
                const observed = e.observedAt ?? e.updatedAt;
                return <small className="tool-evidence" key={n}>
                  {e.source ?? (e.dataMode === 'illustrative' ? 'Wayline sample itinerary' : 'Saved journey')} · {observed && Number.isFinite(Date.parse(observed)) ? new Date(observed).toLocaleString() : 'Observation time unavailable'}
                </small>;
              })}
              {m.actions
                ?.filter((a) => a.payload)
                .map((a, n) => (
                  <Button
                    key={n}
                    kind="primary small"
                    onClick={() => {
                      applyParsed(a.payload);
                      close();
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
            </div>
          </div>
        ))}
        {busy && (
          <div className="thinking" role="status">
            <span />
            <span />
            <span /> Checking your journey…
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="trip-action-strip agent-actions" aria-label="Trip actions">
        <Button disabled={busy} onClick={() => navigate("plan")}>
          Add trip
        </Button>
        {[
          ["Change trip", "change"],
          ["Cancel trip", "cancel"],
          ["Alternatives", "alternatives"],
          ["Download PDF", "pdf"],
        ].map(([label, command]) => (
          <Button
            key={command}
            disabled={
              busy ||
              !active?.version ||
              (["change", "cancel", "alternatives"].includes(command) &&
                ["CANCELLED", "ARRIVED"].includes(active.state ?? ""))
            }
            onClick={() => void send(label, command)}
          >
            {label}
          </Button>
        ))}
      </div>
      {!active?.version && (
        <small>
          Select a saved journey to change, cancel, prepare alternatives, or download its PDF.
        </small>
      )}
      {active?.version && ["CANCELLED", "ARRIVED"].includes(active.state ?? "") && <small>This journey is finished. Its PDF remains available; add a new trip to plan more travel.</small>}
      <div className="agent-prompts">
        {[
          "List my trips",
          "Find a trip from South Station to Harvard tomorrow",
          "Weather forecast",
        ].map((q) => (
          <button key={q} onClick={() => setInput(q)}>
            {q}
          </button>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <form
        className="agent-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          rows={2}
          aria-label="Message your journey assistant"
          placeholder="Ask anything about your journey…"
        />
        <Button
          icon="mic"
          kind={voice ? "active icon-only" : "icon-only"}
          title={voice ? "Stop listening" : "Use voice input"}
          onClick={() => {
            if (voice) {
              recognition.current?.stop();
              setVoice(false);
            } else listen();
          }}
        />
        <Button
          icon="arrow"
          type="submit"
          title="Send message"
          kind="primary icon-only"
          disabled={busy || !input.trim()}
        />
      </form>
      <p className="fine-print">
        The assistant uses your selected journey and never purchases, rebooks or contacts someone.
        Voice recognition may use your browser’s speech service.
      </p>
    </div>
  );
  return inline ? (
    content
  ) : (
    <Modal title="Your journey companion" onClose={close}>
      {content}
    </Modal>
  );
}
interface SpeechRecognizer {
  lang: string;
  onresult: (e: { results: { transcript: string }[][] }) => void;
  onerror: () => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
}

function ToolResult({ result: r }: { result: AgentToolResult }) {
  const { setActive, setResult, navigate } = useApp();
  const [review, setReview] = useState<PendingAction | null>(null);
  const { busy, error, run } = useAsync();
  return (
    <div className="agent-tool-result">
      {r.type === "routes" &&
        r.search.journeys.map((j) => (
          <article key={j.id} className="recovery-option">
            <RouteSummary journey={j} />
            <div className="button-row">
              <Button
                onClick={() => {
                  setResult(r.search);
                  setActive(j);
                  navigate("plan");
                }}
              >
                View map
              </Button>
              <Button
                disabled={busy}
                kind="primary small"
                onClick={() =>
                  void run(async () =>
                    setReview(
                      await api<PendingAction>("/agent/actions", "POST", {
                        kind: r.changeJourneyId ? "change" : "add",
                        journeyId: r.changeJourneyId,
                        searchId: r.search.searchId,
                        candidateId: j.id,
                      }),
                    ),
                  )
                }
              >
                Review {r.changeJourneyId ? "change" : "add"}
              </Button>
            </div>
          </article>
        ))}
      {r.type === "journeys" &&
        r.journeys.map((j) => (
          <button className="assistant-trip" key={j.id} onClick={() => setActive(j)}>
            <b>
              {j.from} → {j.to}
            </b>
            <small>
              {j.state} · {new Date(j.departure).toLocaleString()}
            </small>
          </button>
        ))}
      {r.type === "document" && (
        <a className="btn primary" href={r.url} download>
          {r.label}
        </a>
      )}
      {r.type === "recovery" && <RecoveryOptions items={r.recovery} onReview={setReview} />}{" "}
      {r.type === "weather" && (
        <div className="weather-results">
          {r.periods.slice(0, 4).map((p) => (
            <div key={p.name}>
              <b>
                {p.name} · {p.temperature}°{p.temperatureUnit}
              </b>
              <p>{p.shortForecast}</p>
            </div>
          ))}
          {r.alerts.map((a) => (
            <Notice key={a.id} tone="amber">
              {a.headline}
            </Notice>
          ))}
        </div>
      )}
      {r.type === "status" && <RouteSummary journey={r.journey} />}{" "}
      {review && <ActionReview key={review.id} action={review} />}{" "}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
