import { useEffect, useState } from "react";
import { useApp } from "../context";
import { api, readable } from "../api";
import type { Alert } from "../types";
import type { ConversationSummary, WorkspaceSnapshot } from "../workspaceTypes";
import { Button, Icon, Badge, Notice, Empty, useAsync } from "../components/ui";
export default function Inbox() {
  const { setActive, navigate, notify, boot } = useApp();
  const [alerts, setAlerts] = useState<Alert[]>([]),
    [filter, setFilter] = useState("all");
  const { busy, error, run } = useAsync();
  const load = async () => setAlerts(await api("/guardian/check", "POST"));
  useEffect(() => {
    void run(load);
    const id = setInterval(() => void run(load), 30000);
    return () => clearInterval(id);
  }, []);
  const filtered = alerts.filter(
    (a) => filter === "all" || (filter === "unread" ? !a.read : a.severity === "critical"),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE UPDATES THAT MATTER</span>
          <h1>Your journey inbox</h1>
          <p>Connections, departures and check-ins, in one place.</p>
        </div>
        <Button icon="refresh" disabled={busy} onClick={() => void run(load)}>
          Refresh
        </Button>
      </div>
      <div className="section-title">
        <div className="view-tabs">
          {["all", "unread", "critical"].map((x) => (
            <button key={x} className={filter === x ? "active" : ""} onClick={() => setFilter(x)}>
              {readable(x)}
            </button>
          ))}
        </div>
        <Button
          icon="check"
          disabled={!alerts.some((a) => !a.read) || busy}
          onClick={() =>
            void run(async () => {
              setAlerts(await api("/alerts/read", "POST", { ids: alerts.filter(a => !a.read).map(a => a.id) }));
              notify("Updates marked as read.");
            })
          }
        >
          Mark all read
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="inbox-list">
        {filtered.map((a) => (
          <article className={`inbox-item ${a.read ? "read" : ""} ${a.severity}`} key={a.id}>
            <div className="alert-symbol">
              <Icon
                name={a.kind === "connection" ? "shield" : a.kind === "leave" ? "clock" : "bell"}
              />
            </div>
            <div>
              <div className="button-row">
                {a.conversationId&&<Button kind="small" onClick={()=>{try{localStorage.setItem("wayline.conversation.v1."+boot.user.id,a.conversationId!);}catch{/* Optional local preference. */}navigate("assistant");}}>Open booking conversation</Button>}
                <Badge tone={a.severity === "critical" ? "amber" : ""}>{readable(a.kind)}</Badge>
                {a.dataMode === "illustrative" && <Badge>SAMPLE</Badge>}
                <small>{new Date(a.at ?? a.createdAt).toLocaleString()}</small>
              </div>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
              {a.sourceUrl&&<p><a href={a.sourceUrl} target="_blank" rel="noreferrer">Status source</a>{a.observedAt?" · observed "+new Date(a.observedAt).toLocaleString():""}</p>}
              <div className="button-row">
                {a.journeyId && (
                  <Button kind="small" disabled={busy} onClick={() => void run(async () => {
                    const conversations = await api<ConversationSummary[]>('/conversations');
                    let id = conversations.find(c => c.journeyId === a.journeyId)?.id;
                    if (!id) id = (await api<WorkspaceSnapshot>('/conversations', 'POST', { journeyId: a.journeyId })).conversation.id;
                    try { localStorage.setItem(`wayline.conversation.v1.${boot.user.id}`, id); } catch { /* Server retains the conversation. */ }
                    navigate('assistant');
                  })}>Open trip conversation</Button>
                )}
                {a.journeyId && (
                  <Button
                    kind="small"
                    disabled={busy}
                    onClick={() => void run(async () => {
                      setActive(await api(`/journeys/${a.journeyId}`));
                      navigate("journey");
                    })}
                  >
                    Open journey
                  </Button>
                )}
                {a.commuteId && <Button kind="small" onClick={() => navigate("commute")}>Open commute</Button>}
                {a.kind === "renewal" && <Button kind="small" onClick={() => navigate("commute")}>Manage pass</Button>}
                {!a.read && (
                  <Button
                    kind="small subtle"
                    onClick={() =>
                      void run(async () => {
                        await api(`/records/alert/${a.id}`, "PATCH", { version: a.version });
                        await load();
                      })
                    }
                  >
                    Mark read
                  </Button>
                )}
              </div>
            </div>
            {!a.read && <span className="unread-dot" />}
          </article>
        ))}
      </div>
      {!filtered.length && (
        <Empty icon="bell" title="You’re all caught up">
          Saved journeys create departure reminders and connection updates. Sample journeys remain
          clearly marked.
        </Empty>
      )}
      <Notice>
        Monitoring runs while the Wayline server is running. Enable Web Push in Profile for
        background updates on supported browsers. SMS and email delivery are not connected.
      </Notice>
    </>
  );
}
