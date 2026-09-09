# 6. ESLint scope, and pinning TypeScript to 6.x for tooling compatibility

Status: Accepted (Phase 10, CI and dev workflow)

## Context

Adding ESLint (`eslint.config.js`, flat config) surfaced two separate problems that needed a
real decision each, not just "turn on the recommended config":

1. The project's `typescript` dependency was at 7.0.2. `typescript-eslint` 8.70.0 (the current
   stable line) refuses to run at all against TypeScript >=7 -- a hard runtime guard in
   `typescript-eslint`, `@typescript-eslint/parser`, and `@typescript-eslint/eslint-plugin`
   themselves (not just an npm peer-dependency warning), tracked upstream at
   https://github.com/typescript-eslint/typescript-eslint/issues/10940 as not yet supported.
2. `eslint-plugin-react-hooks` 7.x's `recommended` config bundles a much larger "React Compiler"
   rule set (purity, set-state-in-effect, immutability, static-components, etc.) far beyond the
   two classic hook rules (`rules-of-hooks`, `exhaustive-deps`) this codebase was actually
   written against. Turning all of it on in one pass produced ~20 findings across pre-existing
   pages (e.g. calling `Date.now()` during render, calling `setState` synchronously inside an
   effect) that are legitimate React-Compiler-readiness improvements, but represent a
   substantial follow-up refactor pass, not something a first lint/CI setup should silently
   impose as new build-breaking errors.

## Decision

1. Pin the project's `typescript` dependency to `6.0.3` (the latest stable pre-7.0 release)
   instead of building a manual nested-`node_modules` workaround to let `typescript-eslint` see
   a different TypeScript version than `tsc`/Vite use. A manual nested copy would not be
   recorded in `package-lock.json` and would silently disappear on the next `npm ci` (exactly
   what CI and every fresh clone does), making it non-reproducible; pinning the one real
   dependency everything shares is the only fix that survives a clean install. `tsc -b`, Vite,
   and the full test suite were re-verified clean against 6.0.3 before this was adopted.
2. Enable only `react-hooks/rules-of-hooks` (error) and `react-hooks/exhaustive-deps` (warn)
   from `eslint-plugin-react-hooks`, not its full `recommended` bundle. `exhaustive-deps`
   findings across the codebase (deliberate "run once on mount" effects, mostly) are left as
   warnings -- advisory, not CI-blocking -- since fixing each one correctly requires per-case
   judgment (naively adding a function to a dependency array can introduce an infinite render
   loop if that function's identity isn't stable) that's out of scope for a tooling-setup pass.

## Consequences

- `npm run lint` is 0 errors / a small number of advisory warnings as of this checkpoint, and
  gates CI (errors fail the build; warnings don't).
- TypeScript 7's new native/Go-ported compiler is not in use here. If the project later wants
  its speed benefits, upgrading past 6.x again should wait until `typescript-eslint` officially
  supports it (tracked in the issue above), or accept re-litigating this ADR with a maintained
  workaround.
- The React-Compiler-oriented rules eslint-plugin-react-hooks now ships are a real, tracked
  known-gap (not enabled), not a decision that they don't matter -- see README's "Known gaps"
  for where that's surfaced to a reader who hasn't read this ADR.
