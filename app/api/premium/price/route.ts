/**
 * Premium price oracle — sold per request over x402 ($0.001 in USDC / call).
 *
 * GET /api/premium/price?symbol=bitcoin
 *
 * This is the SELL side of Mimir's payment economy: a paywalled data source any
 * agent can buy from. Mimir's own oracle pays this endpoint when a claim's
 * resolution URL points here — closing the loop where one agent earns USDC by
 * serving another agent's data need.
 *
 * Unpaid requests get a PAYMENT-REQUIRED 402; a signed retry gets a
 * deterministic price snapshot suitable for on-chain settlement.
 */

import { NextResponse, type NextRequest } from "next/server";
import { paidRoute } from "@/lib/x402/server";
import { PRICES } from "@/lib/x402/config";
import { parsePriceSymbol } from "@/lib/price/parse-price-symbol";

const COINGECKO = "https://api.coingecko.com/api/v3";

async function handler(req: NextRequest): Promise<NextResponse> {
  const parsed = parsePriceSymbol(req.nextUrl.searchParams.get("symbol") ?? "bitcoin");
  if (parsed.kind === "invalid") {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const symbol = parsed.symbol;

  try {
    const apiKey = process.env.COINGECKO_API_KEY?.trim();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

    const res = await fetch(
      `${COINGECKO}/simple/price?ids=${encodeURIComponent(symbol)}&vs_currencies=usd&include_last_updated_at=true`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    }
    const payload = (await res.json()) as Record<string, { usd?: number; last_updated_at?: number }>;
    const row = payload[symbol];
    if (!row || typeof row.usd !== "number") {
      return NextResponse.json({ error: "unknown symbol" }, { status: 404 });
    }

    // Deterministic, LLM-friendly snapshot — the same shape the oracle expects.
    return NextResponse.json({
      source: "Mimir Premium Price Oracle",
      symbol,
      price_usd: row.usd,
      last_updated_at: row.last_updated_at ?? null,
      fetched_at: Math.floor(Date.now() / 1000),
      paid: PRICES.premiumPrice,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// Settlement only happens when the handler returns < 400, so an upstream 502
// costs the buyer nothing.
export const GET = paidRoute("premiumPrice", handler);
