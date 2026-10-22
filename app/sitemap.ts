import type { MetadataRoute } from "next";

import { getAllVSFast } from "@/lib/server/vs-cache";
import { filterPublicClaims } from "@/lib/server/sitemap-claims";

const DEFAULT_BASE_URL = "https://mimir.age";

function getBaseUrl() {
  const raw =
    process.env.MIMIR_BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    process.env.VERCEL_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NAVER_BASE_URL ||
    DEFAULT_BASE_URL;

  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_BASE_URL;
  }
}

const STATIC_ROUTES = [
  "/en",
  "/en/explorer",
  "/en/agents",
  "/en/baskets",
  "/en/council",
  "/en/stats",
  "/en/docs",
] as const;

export default async function sitemap(): Promise<MetadataRoute> {
  const baseUrl = getBaseUrl();
  const now = new Date();

  const staticEntries = STATIC_ROUTES.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: route === "/en" ? 1 : 0.7,
  }));

  let claimEntries: MetadataRoute = [];
  try {
    const allClaims = await getAllVSFast();
    claimEntries = filterPublicClaims(allClaims).map((claim) => ({
      url: `${baseUrl}/en/vs/${claim.id}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.6,
    }));
  } catch (error) {
    // Build must pass without a DB configured; fall back to static routes only.
    console.warn("Sitemap: unable to load claims, serving static routes only.", error);
  }

  return [...staticEntries, ...claimEntries];
}
