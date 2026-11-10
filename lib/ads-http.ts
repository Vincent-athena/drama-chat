/** HTTP answers for ad errors. Server only. */
import type { AdError } from "./ads";
import { jsonError } from "./http";

export function adErrorResponse(error: AdError, extra: { retryAfter?: number; resetsAt?: number } = {}): Response {
  switch (error) {
    case "not_found": return jsonError(404, "not_found", "That ad could not be found.");
    case "too_early": return jsonError(409, "too_early", "The ad has not finished yet.", { retryAfter: extra.retryAfter });
    case "used": return jsonError(409, "used", "That ad was already used.");
    case "already_owned": return jsonError(409, "already_owned", "You already have that item.");
    case "ad_cap": return jsonError(429, "ad_cap", "You've watched today's ads. More tomorrow.", { resetsAt: extra.resetsAt });
    case "rate_limited": return jsonError(429, "rate_limited", "Too many ads started. Try again later.", { retryAfter: extra.retryAfter });
    default: return jsonError(400, "bad_request", "That ad request could not be used.");
  }
}
