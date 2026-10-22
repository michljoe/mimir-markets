import { CATEGORIES, normalizeCategoryId, type CategoryId } from "@/lib/constants";
import type { VSData } from "@/lib/contract";

export const EMERGING_NARRATIVES_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const EMERGING_NARRATIVES_TOP_MARKETS = 3;

export type CategoryNarrative = {
  category: CategoryId;
  recentMarketCount: number;
  previousMarketCount: number;
  recentStake: string;
  previousStake: string;
  momentumScoreBps: string;
  topMarkets: VSData[];
};

export type EmergingNarratives = {
  marketCount: number;
  categories: CategoryNarrative[];
};

type EmergingNarrativesOptions = {
  nowSeconds?: number;
  windowSeconds?: number;
  topMarketLimit?: number;
};

function stakeUnits(value: number | undefined): bigint {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0n;

  const [mantissa, exponentText] = value.toString().toLowerCase().split("e");
  const exponent = Number(exponentText ?? 0);
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = BigInt(`${whole}${fraction}`);
  const scale = 7 + exponent - fraction.length;
  if (scale >= 0) return digits * 10n ** BigInt(scale);

  const divisor = 10n ** BigInt(-scale);
  return (digits + divisor / 2n) / divisor;
}

export function marketStakeUnits(market: VSData): bigint {
  return stakeUnits(market.creator_stake) + stakeUnits(market.total_challenger_stake);
}

function growthBasisPoints(recent: bigint, previous: bigint): bigint {
  if (previous === 0n) return recent === 0n ? 0n : 10_000n;
  return ((recent - previous) * 10_000n) / previous;
}

function compareBigIntDescending(left: bigint, right: bigint): number {
  return left === right ? 0 : left > right ? -1 : 1;
}

export function computeEmergingNarratives(
  markets: readonly VSData[],
  options: EmergingNarrativesOptions = {},
): EmergingNarratives {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const windowSeconds = options.windowSeconds ?? EMERGING_NARRATIVES_WINDOW_SECONDS;
  const topMarketLimit = Math.max(0, options.topMarketLimit ?? EMERGING_NARRATIVES_TOP_MARKETS);
  const recentStart = nowSeconds - windowSeconds;
  const previousStart = recentStart - windowSeconds;
  const buckets = new Map<CategoryId, {
    recent: VSData[];
    previous: VSData[];
    recentStake: bigint;
    previousStake: bigint;
  }>();

  for (const { id } of CATEGORIES) {
    buckets.set(id, { recent: [], previous: [], recentStake: 0n, previousStake: 0n });
  }

  let marketCount = 0;
  for (const market of markets) {
    const createdAt = market.created_at;
    if (
      market.state === "cancelled" ||
      typeof createdAt !== "number" ||
      !Number.isFinite(createdAt) ||
      createdAt < previousStart ||
      createdAt > nowSeconds
    ) {
      continue;
    }

    const bucket = buckets.get(normalizeCategoryId(market.category))!;
    marketCount += 1;
    if (createdAt >= recentStart) {
      bucket.recent.push(market);
      bucket.recentStake += marketStakeUnits(market);
    } else {
      bucket.previous.push(market);
      bucket.previousStake += marketStakeUnits(market);
    }
  }

  const categories = Array.from(buckets, ([category, bucket]) => {
    const recentCount = BigInt(bucket.recent.length);
    const previousCount = BigInt(bucket.previous.length);
    const scoreBps = (
      growthBasisPoints(recentCount, previousCount) +
      growthBasisPoints(bucket.recentStake, bucket.previousStake)
    ) / 2n;
    const topMarkets = [...bucket.recent].sort((left, right) => {
      const stakeDiff = compareBigIntDescending(marketStakeUnits(left), marketStakeUnits(right));
      if (stakeDiff !== 0) return stakeDiff;
      const timeDiff = (right.created_at ?? 0) - (left.created_at ?? 0);
      return timeDiff !== 0 ? timeDiff : left.id - right.id;
    }).slice(0, topMarketLimit);

    return {
      category,
      recentMarketCount: bucket.recent.length,
      previousMarketCount: bucket.previous.length,
      recentStake: bucket.recentStake.toString(),
      previousStake: bucket.previousStake.toString(),
      momentumScoreBps: scoreBps.toString(),
      topMarkets,
    } satisfies CategoryNarrative;
  });

  categories.sort((left, right) => {
    const scoreDiff = compareBigIntDescending(
      BigInt(left.momentumScoreBps),
      BigInt(right.momentumScoreBps),
    );
    if (scoreDiff !== 0) return scoreDiff;
    const countDiff = right.recentMarketCount - left.recentMarketCount;
    if (countDiff !== 0) return countDiff;
    const stakeDiff = compareBigIntDescending(
      BigInt(left.recentStake),
      BigInt(right.recentStake),
    );
    if (stakeDiff !== 0) return stakeDiff;
    return left.category < right.category ? -1 : left.category > right.category ? 1 : 0;
  });

  return { marketCount, categories };
}