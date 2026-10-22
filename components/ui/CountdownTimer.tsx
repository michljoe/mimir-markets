"use client";

import { useCountdown } from "@/lib/hooks";
import { formatDeadline } from "@/lib/constants";
import { useLocale } from "next-intl";

interface CountdownTimerProps {
  deadline: number;
  className?: string;
}

export default function CountdownTimer({
  deadline,
  className = "",
}: CountdownTimerProps) {
  const { text, expired } = useCountdown(deadline);
  const locale = useLocale();
  // UTC keeps the accessible deadline stable between server and client renders.
  const absoluteDeadline = Number.isFinite(new Date(deadline * 1000).getTime())
    ? formatDeadline(deadline, locale, "UTC")
    : "";

  return (
    <span
      className={`font-mono font-bold tabular-nums ${
        expired ? "text-pv-gold" : "text-pv-text"
      } ${className}`}
      role="timer"
    >
      {text}
      {/* Browse mode may skip a timer's label, so keep the deadline as real text. */}
      {absoluteDeadline ? (
        <time dateTime={new Date(deadline * 1000).toISOString()} className="sr-only">
          {absoluteDeadline}
        </time>
      ) : null}
    </span>
  );
}
