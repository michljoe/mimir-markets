export const THEME_STORAGE_KEY = "mimir-theme";

export type Theme = "light" | "dark";

export function getSystemTheme(): Theme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

export function parseTheme(value: string | null | undefined): Theme | null {
  if (value === "light" || value === "dark") {
    return value;
  }
  return null;
}

export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.dataset.theme = theme;
  }
}

export function handleThemeStorageEvent(
  event: Pick<StorageEvent, "key" | "newValue">,
  onThemeChange?: (theme: Theme) => void
): Theme | null {
  if (event.key !== THEME_STORAGE_KEY) {
    return null;
  }

  const parsed = parseTheme(event.newValue);
  const nextTheme = parsed ?? getSystemTheme();

  applyTheme(nextTheme);
  onThemeChange?.(nextTheme);

  return nextTheme;
}
