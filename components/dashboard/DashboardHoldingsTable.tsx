"use client";

import React, { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface DashboardHoldingRow {
  id: string;
  symbol: string;
  name?: string;
  amount?: React.ReactNode;
  value?: React.ReactNode;
  change?: React.ReactNode;
}

export interface DashboardHoldingsTableProps {
  holdings: DashboardHoldingRow[];
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  isLoading?: boolean;
  emptyMessage?: string;
}

function HoldingsSkeleton() {
  return (
    <div className="space-y-2 p-4" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-10 animate-pulse rounded bg-slate-200 dark:bg-slate-700"
        />
      ))}
    </div>
  );
}

export default function DashboardHoldingsTable({
  className,
  emptyMessage = "No holdings to display.",
  holdings,
  isLoading = false,
  onPageChange,
  page,
  pageSize,
  totalPages,
}: DashboardHoldingsTableProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);

  const visibleHoldings = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return holdings.slice(start, start + pageSize);
  }, [holdings, pageSize, safePage]);

  const canGoPrevious = safePage > 1;
  const canGoNext = safePage < safeTotalPages;

  return (
    <section
      aria-label="Portfolio holdings"
      className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className ?? ""}`}
    >
      {isLoading ? (
        <HoldingsSkeleton />
      ) : visibleHoldings.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {emptyMessage}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                  Asset
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">
                  Amount
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">
                  Value
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">
                  Change
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleHoldings.map((holding) => (
                <tr key={holding.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 dark:text-slate-50">
                      {holding.symbol}
                    </div>
                    {holding.name ? (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {holding.name}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-200">
                    {holding.amount ?? "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-200">
                    {holding.value ?? "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-200">
                    {holding.change ?? "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-slate-800">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Page {safePage} of {safeTotalPages}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(safePage - 1)}
            disabled={!canGoPrevious}
            aria-label="Previous page"
            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Prev
          </button>
          <button
            type="button"
            onClick={() => onPageChange(safePage + 1)}
            disabled={!canGoNext}
            aria-label="Next page"
            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Next
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}