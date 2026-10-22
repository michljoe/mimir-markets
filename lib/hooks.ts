"use client";

import { useState, useEffect } from "react";
import { getTimeRemaining } from "@/lib/constants";
import { useLocale } from "next-intl";
import { resolveCountdownLocale } from "@i18n/locale";

export function shouldKeepTicking(state: { expired: boolean } | null | undefined): boolean {
  return Boolean(state && !state.expired);
}

export function useCountdown(deadline: number) {
  const locale = useLocale();
  const countdownLocale = resolveCountdownLocale(locale);
  const [state, setState] = useState(() => getTimeRemaining(deadline, countdownLocale));

  useEffect(() => {
    const initial = getTimeRemaining(deadline, countdownLocale);
    setState(initial);
    if (!shouldKeepTicking(initial)) {
      return;
    }

    const interval = setInterval(() => {
      const next = getTimeRemaining(deadline, countdownLocale);
      setState(next);
      if (!shouldKeepTicking(next)) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [deadline, countdownLocale]);

  return state;
}
