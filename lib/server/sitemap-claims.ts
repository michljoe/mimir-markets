import type { VGData } from "@/lib/contract";

export const SITEMAP_CLAIM_LIMIT = 500;

type SitemapClaimSource = VGData & {
  is_private?: boolean;
  private?: boolean;
  invite_key?: string | null;
  inviteKey?: string | null;
  invite_key_hash?: string | null;
};

function isPrivateClaim(claim: SitemapClaimSource) {
  if (claim.is_private === true || claim.private === true) {
    return true;
  }

  const inviteKey = claim.invite_key ?? claim.inviteKey ?? claim.invite_key_hash;
  return typeof inviteKey === "string" && inviteKey.length > 0;
}

/**
 * Public, indexable claims for the sitemap.
 *
 * Private claims (invite-key protected) must never be listed. We detect them
 * defensively: any claim carrying an invite key or private flag is dropped, and
 * only claims with a positive integer id are kept. The result is capped to the
 * latest by id so the sitemap stays bounded.
 */
export function filterPublicClaims<T>(
  items: readonly T[],
  limit: number = SITEMAP_CLAIM_LIMIT
): T[] {
  const public = items.filter((item) => {
    const claim = item as unknown as SitemapClaimSource;
    if (!claim || typeof claim !== "object") {
      return false;
    }
    if (!Number.isInteger(claim.id) || claim.id <= 0) {
      return false;
    }
    return !isPrivateClaim(claim);
  });

  const sorted = [...public].sort((a, b) => {
    const aId = (a as unknown as SitemapClaimSource).id;
    const bId = (b as unknown as SitemapClaimSource).id;
    return bId - aId;
  });

  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }

  return sorted.slice(0, Math.floor(limit));
}
