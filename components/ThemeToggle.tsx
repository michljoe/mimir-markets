"use client";

/**
 * Light/dark switch. The palette lives in CSS variables (app/globals.css), so this
 * only has to flip one attribute on <html> — no re-render of anything below it.
 *
 * The stored choice is read by an inline script in app/layout.tsx before first
 * paint. Reading it here instead would flash the wrong theme on every navigation.
 */

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import {
  THEME_STORAGE_KEY,
  Theme,
  handleThemeStorageEvent,
} from "@/lib/theme";

export { THEME_STORAGE_KEY };

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  // Starts undefined so the button renders the same markup the server sent; a
  // guessed initial value would hydrate-mismatch against the inline script.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(currentTheme());

    const onStorage = (event: StorageEvent) => {
      handleThemeStorageEvent(event, (nextTheme) => {
        setTheme(nextTheme);
      });
    };

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function toggle() {
    const next: Theme = currentTheme() === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode or a blocked store: the theme still applies for this page.
    }
  }

  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
      title={isLight ? "Dark theme" : "Light theme"}
      className={`grid h-9 w-9 place-items-center border border-pv-ink/[0.14] text-pv-muted transition-colors duration-150 hover:border-pv-ink/[0.28] hover:text-pv-text ${className}`}
    >
      {/* Both icons ship; visibility is CSS-driven so the first paint is correct
          even before this component hydrates. */}
      <Sun className="hidden h-4 w-4 [:root[data-theme='light']_&]:block" aria-hidden />
      <Moon className="h-4 w-4 [:root[data-theme='light']_&]:hidden" aria-hidden />
    </button>
  );
}
