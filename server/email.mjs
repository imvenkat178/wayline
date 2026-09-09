// A pluggable email-sending seam (roadmap features 95/96: email verification, password
// recovery). Actually delivering an email needs a provider account -- SES, Postmark, Resend, an
// SMTP relay, something with a real sending domain and reputation -- which is exactly the kind
// of external, contracted dependency this session's plan explicitly does not attempt to fake.
// Rather than skip password recovery entirely, or pretend a provider is connected when none is,
// this defines the interface once so wiring in a real provider later is a single adapter
// implementation, not a redesign: everything that needs to send mail (see store.mjs's
// requestPasswordReset) calls `provider.send({to, subject, text})` and never touches a specific
// vendor's API directly.

// The default, always-available provider: logs the message instead of sending it. This is the
// provider server.mjs wires up unless a real one is configured (there is no real one in this
// codebase yet), and it is clearly labeled as such everywhere it's user-visible -- see
// router.mjs's recovery-request response and FEATURE_STATUS.md/README.md.
export class LogEmailProvider {
  constructor({ quiet = false } = {}) {
    this.quiet = quiet;
    this.sent = []; // Kept for tests to assert against; harmless in production (small, in-memory).
  }
  async send({ to, subject, text }) {
    this.sent.push({ to, subject, text, at: Date.now() });
    if (!this.quiet)
      console.log(
        JSON.stringify({
          level: "info",
          message: "Email not actually sent -- no provider configured (see server/email.mjs)",
          to,
          subject,
        }),
      );
    return { ok: true, delivered: false };
  }
}
