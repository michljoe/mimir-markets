import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { computeEmergingNarratives } from "@/lib/emerging-narratives";
import { buildVSCacheFreshness } from "@/lib/vs-freshness";
import { getAllVSFastSnapshot, VS_REVALIDATE_SECONDS } from "@/lib/server/vs-cache";
import EmergingNarrativesClient from "./EmergingNarrativesClient";

export const dynamic = "force-dynamic";

type EmergingNarrativesPageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: EmergingNarrativesPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "emergingNarratives" });
  const tMeta = await getTranslations({ locale, namespace: "metadata" });
  const siteLine = tMeta("title");
  const brand = siteLine.split("—")[0]?.trim() ?? "Mimir";
  const pageTitle = `${t("title")} · ${brand}`;

  return {
    title: pageTitle,
    description: t("lead"),
    openGraph: {
      title: pageTitle,
      description: t("lead"),
    },
  };
}

export default async function EmergingNarrativesPage() {
  try {
    const snapshot = await getAllVSFastSnapshot();
    return (
      <EmergingNarrativesClient
        narratives={computeEmergingNarratives(snapshot.items)}
        freshness={buildVSCacheFreshness({
          updatedAtMs: snapshot.syncedAt,
          freshnessWindowMs: VS_REVALIDATE_SECONDS * 1000,
          source: "index",
        })}
      />
    );
  } catch {
    return <EmergingNarrativesClient error />;
  }
}

