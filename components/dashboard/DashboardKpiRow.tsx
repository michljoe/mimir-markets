"use client";

import React from "react";

export interface DashboardKpiItem {
  id: string;
  label: string;
  value: React.ReactNode;
  helperText?: string;
  trend?: {
    direction: "up" | "down" | "flat";
    label: string;
  };
}

export interface DashboardKpiRowProps {
  items: DashboardKpiItem[];
  className?: string;
  isLoading?: boolean;
}

const trendColors: Record<NonNullable<DashboardKpiItem["trend"]>["direction"], string> = {
  up: "text-emerald-600 dark:text-emerald-400",
  down: "text-rose-600 dark:text-rose-400",
  flat: "text-slate-500 dark:text-slate-400",
};

const trendArrows: Record<NonNullable<DashboardKpiItem["trend"]>["direction"], string> = {
  up: "\u2191",
  down: "\u2193",
  flat: "\u2192",
};

function KpiSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700 ${className ?? ""}`}
      aria-hidden="true"
    />
  );
}

export default function DashboardKpiRow({ className, isLoading = false, items }: DashboardKpiRowProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Portfolio key performance indicators"
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 ${className ?? ""}`}
    >
      {items.map((item) => (
        <article
          key={item.id}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <h3
            className="text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {item.label}
          </h3>
          {isLoading ? (
            <div className="mt-3 space-y-2">
              <KpiSkeleton className="h-8" />
              <KpiSkeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <>
              <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">
                {item.value}
              </div>
              {item.trend ? (
                <p
                  className={`mt-1 flex items-center gap-1 text-sm font-medium ${trendColors[item.trend.direction]}`}
                >
                  <span aria-hidden="true">{trendArrows[item.trend.direction]}</span>
                  <span>{item.trend.label}</span>
                </p>
              ) : null}
              {item.helperText ? (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {item.helperText}
                </p>
              ) : null}
            </>
          )}
        </article>
      ))}
    </section>
  );
}