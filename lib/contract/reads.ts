/**
 * Read-only contract helpers.
 *
 * Houses the raw contract read paths (single claim and range queries) that
 * wrap the generated bindings client. No state-changing logic lives here.
 */

import { getContractClient } from './client';

export interface RawClaim {
  id: bigint;
  creator: string;
  amount: bigint;
  status: number;
  createdAt: bigint;
  expiresAt: bigint;
  metadataURi?: string;
}

export interface RawClaimRange {
  claims: RawClaim[];
  nextCursor?: bigin;
  total: number;
}

/**
 * Fetch a single claim by id directly from the contract.
 * Returns null when the claim does not exist.
 */
export async function readClaimRaw(id: bigint | number | string): Promise<RawClaim | null> {
  const client = getContractClient();
  const claimId = typeof id === 'bigint' ? id : BigInt(id);
  try {
    const result = await client.readClaim({ id: claimId });
    if (!result) {
      return null;
    }
    return normalizeRawClaim(result);
  } catch (err) {
    if (isNotFoundError(err)) {
      return null;
    }
    throw err;
  }
}

/**
 * Fetch a page of claims within a cursor range.
 */
export async function readClaimsRange(
  startCursor: bigint | number | string = 0,
  limit: number = 20,
): Promise<RawClaimRange> {
  const client = getContractClient();
  const cursor = typeof startCursor === 'bigint' ? startCursor : BigInt(startCursor);
  const result = await client.readClaimsRange({ startCursor: cursor, limit: BigInt(limit) });
  const claims = (result.claims ?? []).map(normalizeRawClaim);
  return {
    claims,
    nextCursor: result.nextCursor ?? undefined,
    total: claims.length,
  };
}

function normalizeRawClaim(input: any): RawClaim {
  return {
    id: toBigInt(input.id),
    creator: String(input.creator),
    amount: toBigInt(input.amount),
    status: Number(input.status),
    createdAt: toBigInt(input.createdAt),
    expiresAt: toBigInt(input.expiresAt),
    metadataUri: input.metadataUri ?? undefined,
  };
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = String((err as { message?: unknown }).message ?? '').toLowerCase();
  return message.includes('not found') || message.includes('notfound');
}
