import { authorizeRequest } from "@/lib/api/rate-limit";
import { moderateClaim } from "@/lib/server/claim-moderation";
import { handleClaimModerationPost } from "@/lib/server/claim-moderation-route-handler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorization = authorizeRequest("claim_moderation", request);
  if (!authorization.ok) {
    return authorization.response;
  }

  return handleClaimModerationPost({ request, moderateClaim });
}