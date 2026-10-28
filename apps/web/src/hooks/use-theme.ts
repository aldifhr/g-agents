"use client";

import { useCallback, useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Theme, mirrored onto `<html data-theme>`.
 *
 * The initial value is read from the OS preference; the user's toggle wins
 * afterwards and is remembered in localStorage.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem("agent-chat-theme") as Theme | null;
    const initial: Theme =
      stored ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      window.localStorage.setItem("agent-chat-theme", next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
