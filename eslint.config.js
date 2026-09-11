// ESLint flat config (Phase 10, "CI and dev workflow" -- roadmap Maintainability section).
// One config for the whole repo: browser/React rules for src/**, plain Node rules for
// server/**, scripts/** and tests/**. This is a starting baseline, not a from-scratch style
// guide -- it turns on the recommended rule sets plus the two React-hooks rules that catch
// real bugs (stale closures, missing dependencies), and otherwise defers to Prettier for
// formatting (no stylistic rules here; `.prettierrc.json` already owns that).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "data/**",
      ".runtime/**",
      "tmp/**",
      "output/**",
      "standalone/**",
      "public/ocr/**",
      "artifacts/**",
      "coverage/**",
      ".tsx-test-cache/**",
      "*.tsbuildinfo",
    ],
  },
  {files:["public/theme-init.js"],languageOptions:{globals:globals.browser}},
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // eslint-plugin-react-hooks 7.x's "recommended" config bundles a much larger set of
      // React-Compiler-oriented rules (purity, set-state-in-effect, immutability, etc.) beyond
      // the two classic hook rules this project has actually been written against. Turning all
      // of those on in one pass surfaced ~20 real style/pattern findings across pre-existing
      // pages (calling Date.now() during render, setState called synchronously in an effect)
      // that are legitimate React-Compiler-readiness improvements, but fixing them is its own
      // follow-up pass, not something a first CI/lint setup should silently take on -- so only
      // the two rules this codebase was actually written to satisfy are enabled here. See
      // docs/adr/0006-eslint-scope.md for the reasoning and the list of rules left off for now.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Every roadmap-required "sample"/"illustrative"/synthetic value in this codebase is
      // deliberately labeled that way in code and docs (see FEATURE_STATUS.md); an unused-var
      // rule strict enough to flag every intentionally-unread destructured field would fight
      // that pattern more than it would catch real bugs, so this only requires that _-prefixed
      // placeholders are allowed, matching common TypeScript convention.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["server/**/*.mjs", "scripts/**/*.mjs", "*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    files: ["tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Test files intentionally destructure results they only assert a subset of.
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["vite.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // public/sw.js runs in the Service Worker global scope (self, caches, fetch, URL, etc.),
    // not a browser window or a Node process -- neither globals.browser nor globals.node covers
    // it correctly.
    files: ["public/sw.js"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.serviceworker,
    },
  },
);
