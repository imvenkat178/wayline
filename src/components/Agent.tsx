import { useEffect, useRef, useState } from "react";
import { useApp } from "../context";
import { api, readable, copyText } from "../api";
import type { AgentResult } from "../types";
import { Modal, Icon, Button, Badge, Notice, useAsync } from "./ui";
export function Agent({ initialPrompt, close }: { initialPrompt: string; close: () => void }) {
  const { active, result, applyParsed, boot, notify } = useApp();
  const [messages, setMessages] = useState<AgentResult[]>([]),
    [input, setInput] = useState(initialPrompt),
    [voice, setVoice] = useState(false);
  const { busy, error, run } = useAsync();
  const bottom = useRef<HTMLDivElement>(null);
  const recognition = useRef<{ stop: () => void } | null>(null);
  useEffect(() => {
    void api<AgentResult[]>("/agent/history")
      .then(setMessages)
      .catch(() => {});
    return () => recognition.current?.stop();
  }, []);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages, busy]);
  const send = () =>
    run(async () => {
      const query = input.trim();
      if (!query) return;
      setInput("");
      const context = active?.version
        ? { journeyId: active.id }
        : result
          ? { searchId: result.searchId, candidateId: active?.id ?? result.journeys[0]?.id }
          : {};
      const reply = await api<AgentResult>("/agent", "POST", { input: query, ...context });
      setMessages((m) => [...m, { ...reply, input: query }]);
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
  return (
    <Modal title="Your journey companion" onClose={close}>
      <div className="agent-context">
        <span className="guardian-orb">
          <Icon name="spark" />
        </span>
        <div>
          <b>Wayline Assistant</b>
          <small>{active ? `${active.from} → ${active.to}` : "Let’s get you there"}</small>
        </div>
        <Badge>ADVICE & PLANNING</Badge>
      </div>
      <div className="agent-messages">
        {!messages.length && (
          <div className="assistant-welcome">
            <h3>A calm voice for the whole journey.</h3>
            <p>Ask about a connection, a fare, a station, or what to do next.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <div className="message user-message">{m.input}</div>
            <div className="message assistant-message">
              <div className="section-title">
                <Badge>
                  <Icon name="spark" size={13} />
                  {m.mode}
                </Badge>
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
              {m.actions?.map((a, n) => (
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
      <div className="agent-prompts">
        {["Will I make my connection?", "Where should I board?", "Explain the total cost"].map(
          (q) => (
            <button key={q} onClick={() => setInput(q)}>
              {q}
            </button>
          ),
        )}
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
