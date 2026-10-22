"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Link } from "@/i18n/navigation";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import EmptyState from "@/components/EmptyState";
import StaleIndexWarning from "@/components/StaleIndexWarning";
import { marketStakeUnits, type EmergingNarratives } from "@/lib/emerging-narratives";
import type { VSCacheFreshness } from "@/lib/vs-freshness";

type EmergingNarrativesClientProps = {
  narratives?: EmergingNarratives;
  freshness?: VSCacheFreshness | null;
  error?: boolean;
};

function formatStake(value: string, locale: string) {
  const atomic = BigInt(value);
  const cents = (atomic + 50_000n) / 100_000n;
  const decimalSeparator = new Intl.NumberFormat(locale)
    .formatToParts(1.1)
    .find((part) => part.type === "decimal")?.value ?? ".";
  return `${(cents / 100n).toLocaleString(locale)}${decimalSeparator}${(cents % 100n).toString().padStart(2, "0")}`;
}

function formatMomentum(value: string) {
  const bps = BigInt(value);
  const absoluteBps = bps < 0n ? -bps : bps;
  const sign = bps > 0n ? "+" : bps < 0n ? "-" : "";
  const whole = absoluteBps / 100n;
  const fraction = absoluteBps % 100n;
  return `${sign}${whole}.${fraction.toString().padStart(2, "0")}%`;
}

export default function EmergingNarrativesClient({
  narratives,
  freshness = null,
  error = false,
}: EmergingNarrativesClientProps) {
  const t = useTranslations("emergingNarratives");
  const tCat = useTranslations("categories");
  const locale = useLocale();
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const activeCategories = narratives?.categories.filter(
    (category) => category.recentMarketCount > 0 || category.previousMarketCount > 0,
  ) ?? [];

  return (
    <PageTransition>
      <AnimatedItem>
        <div className="min-w-0 pb-8">
          <BlueprintHeading>{t("title")}</BlueprintHeading>
          <div className="min-w-0 px-4 pt-6 sm:px-6 lg:px-8">
            <div className="mx-auto mb-8 max-w-5xl">
              <p className="mb-5 max-w-2xl font-mono text-xs font-bold uppercase tracking-[0.18em] leading-relaxed text-pv-emerald sm:text-sm">
                {t("lead")}
              </p>
              <StaleIndexWarning
                freshness={freshness}
                refreshing={refreshing}
                onRefresh={() => startTransition(() => router.refresh())}
              />
            </div>

            {error ? (
              <div role="alert" className="mx-auto max-w-5xl border border-pv-danger/35 bg-pv-danger/[0.06] px-4">
                <EmptyState title={t("errorTitle")} description={t("errorDescription")} />
              </div>
            ) : activeCategories.length === 0 ? (
              <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
            ) : (
              <div className="mx-auto grid min-w-0 max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
                {activeCategories.map((category, index) => (
                  <article
                    key={category.category}
                    className="min-w-0 border border-pv-ink/[0.12] bg-pv-surface/70 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] sm:p-5"
                  >
                    <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted">
                          {t("rank", { rank: index + 1 })}
                        </p>
                        <h2 className="break-words font-display text-xl font-bold uppercase text-pv-text">
                          {tCat(category.category)}
                        </h2>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-pv-muted">
                          {t("momentum")}
                        </p>
                        <p className="font-display text-lg font-bold text-pv-emerald">
                          {formatMomentum(category.momentumScoreBps)}
                        </p>
                      </div>
                    </div>

                    <div className="mb-4 grid grid-cols-2 gap-3 border-y border-pv-ink/[0.1] py-3">
                      <div className="min-w-0">
                        <p className="text-xs text-pv-muted">{t("newMarkets")}</p>
                        <p className="font-mono text-sm font-bold text-pv-text">
                          {category.recentMarketCount} <span className="text-pv-muted">/ {category.previousMarketCount}</span>
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-pv-muted">{t("newStake")}</p>
                        <p className="break-words font-mono text-sm font-bold text-pv-text">
                          {formatStake(category.recentStake, locale)} <span className="text-pv-muted">/ {formatStake(category.previousStake, locale)}</span>
                        </p>
                      </div>
                    </div>

                    <div className="mb-4 flex flex-wrap gap-x-2 gap-y-1 text-[10px] font-mono uppercase tracking-[0.12em] text-pv-muted">
                      <span>{t("windowLabels")}</span>
                    </div>
                    <div className="mb-4 space-y-2">
                      {category.topMarkets.map((market) => (
                        <Link
                          key={market.id}
                          href={`/vs/${market.id}`}
                          className="block min-w-0 border border-pv-ink/[0.08] px-3 py-2 text-sm text-pv-text transition-colors hover:border-pv-emerald/40 hover:text-pv-emerald"
                        >
                          <span className="block break-words">{market.question}</span>
                          <span className="mt-1 block font-mono text-[10px] text-pv-muted">
                            {t("marketStake", { amount: formatStake(marketStakeUnits(market).toString(), locale) })}
                          </span>
                        </Link>
                      ))}
                    </div>
                    <Link
                      href={`/explorer?cat=${category.category}`}
                      className="inline-flex min-h-11 max-w-full items-center break-words border border-pv-emerald/35 px-3 py-2 font-display text-xs font-bold uppercase text-pv-emerald transition-colors hover:bg-pv-emerald/10"
                    >
                      {t("viewCategory", { category: tCat(category.category) })}
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </AnimatedItem>
    </PageTransition>
  );
}

