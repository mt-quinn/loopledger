"use client";

import { useEffect, useState } from "react";
import { THEME_KEY } from "./project-types";

export type AppTheme = "light" | "dark";

export function useStoredTheme() {
  const [theme, setTheme] = useState<AppTheme>("light");
  // Guards the write-back effect so the pre-hydration theme (stamped on
  // <html> by the inline script in layout.tsx) is never clobbered by the
  // default state before localStorage has been read.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") {
      setTheme(stored);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme, hydrated]);

  return { theme, setTheme };
}
