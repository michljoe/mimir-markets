import { defineRouting } from "next-intl/routing";

export const routing = defineRouting( {
  locales: ["en"],
  defaultLocale: "en",
  localePrefix: "always",
});

/**
 * Maps an unknown/supported locale to a locale safe for countdown formatting.
 * Any locale not in the routing config falls back to the default locale.
 */
export function resolveCountdownLocale(locale: string | undefined | null): string {
  if (locale && (routing.locales as readonly string[]).includes(locale)) {
    return locale;
  }
  return routing.defaultLocale;
}
