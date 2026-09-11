import { Component, type ReactNode } from "react";
import { Button, Notice } from "./ui";

export default class SectionErrorBoundary extends Component<
  { children: ReactNode; onOffline: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="empty-state" aria-labelledby="section-recovery-title">
        <h2 id="section-recovery-title">Let’s get you back on track</h2>
        <Notice tone="amber">
          This section couldn’t open. Wayline may have updated, or the connection was interrupted.
          Your saved journeys are still available when you reconnect.
        </Notice>
        <div className="button-row">
          <Button kind="primary" onClick={() => location.reload()}>Reload Wayline</Button>
          <Button icon="lock" onClick={this.props.onOffline}>Open offline packs</Button>
        </div>
      </section>
    );
  }
}
