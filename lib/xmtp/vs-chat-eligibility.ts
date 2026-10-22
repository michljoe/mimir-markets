/*
 * Product rules: XMTP chat only in accepted 1v1 VS (
 * Step 5).
 * No dependency on `@xmtp/browser-sdk` (safe for tests / light server imports).
 */

import type { VSData } from "@/lib/contract";
import { getVSChallengerCount, getVSConfiguredMaxChallengers } from "@/lib/contract";
import { ZERO_ADDRESS } from "@/lib/constants";
import { MOCK_CREATED_VS_ID } from "@/lib/mockVsCreate";
import { SAMPLE_VS } from "@/lib/sampleVs";

/** Anchor on `/vs/[id=` to link from the messages hub. */
export const VS_XMTP_CHAT_ANCHOR_ID = "proven-xmtp-vs-chat";

/** Sample VS (negative ids in `SAMPLE_VS`): excludes hub / networking except for the 1v1 demo in detail. */
export function isSampleVsIdForXmtp(vsId: number): boolean {
  return vsId < 0 && Object.prototype.hasOwnProperty.call(SAMPLE_VS, vsId);
}

/**
 * Demo `/vs/create?demo=1` → ticket `-4`: local 1v1 bet (same panel UX as a real VS).
 */
export function isOneVsOneDemoVs(vs: VSData): boolean {
  return vs.id === MOCK_CREATED_VS_ID && getVSConfiguredMaxChallengers(vs) === 1;
}

/** Mount `VsXmtpPanel` on `/vs/[id`: on-chain or 1v1 demo (-4). */
export function shouldMountVsXmtpPanelOnDetailPage(vs: VSData): boolean {
  return vs.id >= 0 || isOneVsOneDemoVs(vs);
}

/**
 * 1v1 demo: if the opponent is not on XMTP, show a thread mock (no real send).
 * On-chain VSs still show the standard error message + Retry.
 */
export function shouldShowXmtpPeerUnreachableChatPreview(
  vs: VSData,
  errorKind: string | null | undefined
): boolean {
  return isOneVsOneDemoVs(vs) && errorKind === "peer_unreachable";
}

/** Reason why there is no XMTP chat yet in this VS (for UI copy). */
export type VsXmtpChatUnavailableReason =
  | "sample"
  | "not_accepted"
  | "waiting_opponent"
  | "multi_challenger";

/** VS in accepted state, with a single challenger and a defined on-chain opponent. */
export function canOpenVsXmtpChat(vs: VSData): boolean {
  if (vs.state !== "accepted") return false;
  if (!vs.opponent || vs.opponent === ZERO_ADDRESS) return false;
  if (getVSChallengerCount(vs) !== 1) return false;
  return true;
}

/**
 * If XMTP chat is not available, returns the reason; if available, `null`.
 * Does not check the wallet: only the VS state.
 */
export function getVsXmtpUnavailableReason(
  vs: VSData
): VsXmtpChatUnavailableReason | null {
  if (isSampleVsIdForXmtp(vs.id) && !isOneVsOneDemoVs(vs)) return "sample";
  if (canOpenVsXmtpChat(vs)) return null;
  if (getVSChallengerCount(vs) > 1) return "multi_challenger";
  if (vs.state !== "accepted") return "not_accepted";
  if (!vs.opponent || vs.opponent === ZERO_ADDRESS) return "waiting_opponent";
  return "not_accepted";
}

/**
 * Counterpart address on XMTP (
 * the other side of the 1v1).
 * `viewer` must be the creator or the opponent (case-insensitive comparison).
 */
export function getVsXmtpPeerAddress(
  vs: VSData,
  viewerAddress: string | null | undefined
): string | null {
  if (!viewerAddress || !canOpenVsXmtpChat(vs)) return null;
  const v = viewerAddress.toLowerCase();
  const c = vs.creator.toLowerCase();
  const o = vs.opponent.toLowerCase();
  if (v === c) return vs.opponent;
  if (v === o) return vs.creator;
  return null;
}
