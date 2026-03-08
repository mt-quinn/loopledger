"use client";

import { useEffect, useState } from "react";
import { THEME_KEY } from "./project-types";

export type AppTheme = "light" | "dark";

export function useStoredTheme() {
  const [theme, setTheme] = useState<AppTheme>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return { theme, setTheme };
}
