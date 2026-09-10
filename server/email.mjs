// A pluggable email-sending seam (roadmap features 95/96: email verification, password
// recovery). Actually delivering an email needs a provider account -- SES, Postmark, Resend, an
// SMTP relay, something with a real sending domain and reputation -- which is exactly the kind
// of external, contracted dependency this session's plan explicitly does not attempt to fake.
// Rather than skip password recovery entirely, or pretend a provider is connected when none is,
// this defines the interface once so wiring in a real provider later is a single adapter
// implementation, not a redesign: everything that needs to send mail (see router.mjs's
// /api/auth/recovery/request handler) calls `provider.send({to, subject, text})` and never
// touches a specific vendor's API directly.
//
// R09: every provider here also exposes a `real` capability flag -- a static, deployment-wide
// constant (true only for an adapter that genuinely reaches a recipient's inbox), never a
// per-message result. router.mjs's recovery-request response is built from this flag, not from
// any individual message's outcome, and that distinction matters for two reasons at once:
//   1. Honesty -- before this fix, the response always claimed "a reset link has been sent,"
//      which was false for every account when only this log-only default was configured. An
//      ordinary user had no way to actually recover their account and no way to know that.
//   2. Enumeration resistance -- the response must stay byte-identical whether or not the given
//      email has an account (see router.mjs's own comment on that endpoint). A per-message
//      "delivered" result can't drive the response text without leaking account existence: a
//      known email reaches a real send attempt while an unknown one never does, so their
//      individual outcomes differ in a way a per-call flag would expose. A provider-level
//      constant carries no such per-request signal.

// The default, always-available provider: logs the message instead of sending it. This is the
// provider server.mjs wires up unless a real one is configured (there is no real one in this
// codebase yet), and it is clearly labeled as such everywhere it's user-visible -- see
// router.mjs's recovery-request response and FEATURE_STATUS.md/README.md.
export class LogEmailProvider {
  real = false;
  constructor({ quiet = false } = {}) {
    this.quiet = quiet;
  }
  async send({ to, subject }) {
    // Deliberately logs only metadata (recipient, subject) -- never the message body, and never
    // a reset link or other single-use token. The recovery token already lives in the database
    // with its own expiry and single-use enforcement (store.mjs); a server log is typically
    // retained longer, shipped to more places (aggregators, error trackers), and access-
    // controlled less tightly than that primary database, so it is not a second place for the
    // same secret to live. (This also matches the R09 acceptance check that logs and traces
    // exclude reset tokens.)
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

// Test-only: captures full sent messages, including the body/link, in memory so a test can
// assert on what would have been sent (e.g. extracting a reset token to drive the rest of a
// recovery flow end to end). Bounded only by what a single test run creates -- fine for a test
// process's short lifetime, but never appropriate in production, which is why server.mjs's
// default (LogEmailProvider, above) has no such array: a long-running server process must not
// accumulate an unbounded, ever-growing list of past reset links/tokens in memory purely because
// nothing ever trims it. This class is never imported or referenced by server.mjs or any
// production code path -- only by tests, which construct it explicitly (see tests/email.test.mjs).
export class TestCaptureEmailProvider {
  real = false; // Still not a genuine delivery mechanism -- just visible to the test that sent it.
  constructor() {
    this.sent = [];
  }
  async send({ to, subject, text }) {
    this.sent.push({ to, subject, text, at: Date.now() });
    return { ok: true, delivered: false };
  }
}
