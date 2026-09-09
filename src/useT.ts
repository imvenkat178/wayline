// Thin React binding over src/i18n.ts's pure catalog/formatters, reading the active locale from
// the signed-in user's own `preferences.language` (falling back to English for a locale i18n.ts
// doesn't recognize) so every consumer gets a translator and locale-aware formatters bound to
// the current user without re-deriving the locale itself.
import { useApp } from "./context";
import {
  t as translate,
  formatDate as fmtDate,
  formatDateTime as fmtDateTime,
  formatNumber as fmtNumber,
  formatCurrencyCents as fmtCurrencyCents,
  localeTags,
  SUPPORTED_LOCALES,
  type Locale,
} from "./i18n";

function resolveLocale(language: string | undefined): Locale {
  return (SUPPORTED_LOCALES as string[]).includes(language ?? "") ? (language as Locale) : "en";
}

export function useT() {
  const { boot } = useApp();
  const locale = resolveLocale(boot.user.preferences.language);
  return {
    locale,
    localeTag: localeTags[locale],
    t: (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    formatDate: (iso: string | number | Date, opts?: Intl.DateTimeFormatOptions) =>
      fmtDate(locale, iso, opts),
    formatDateTime: (iso: string | number | Date, timeZone?: string) =>
      fmtDateTime(locale, iso, timeZone),
    formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => fmtNumber(locale, n, opts),
    formatCurrencyCents: (cents: number | null | undefined, currency = "USD") =>
      fmtCurrencyCents(locale, cents, currency),
  };
}
