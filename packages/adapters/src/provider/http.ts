import type { ProviderError } from "@easypws/contracts";

/** Map a non-200 status to a permanent classification. This does not schedule a retry. */
export function classifyHttpStatus(status: number): ProviderError {
  if (status === 401 || status === 403) {
    return { errorClass: "authorization", reason: "authorization_rejected", retryable: false };
  }
  if (status === 404) {
    return { errorClass: "not_found", reason: "not_found", retryable: false };
  }
  if (status === 429) {
    return { errorClass: "rate_limited", reason: "rate_limited", retryable: false };
  }
  if (status >= 500 && status <= 599) {
    return { errorClass: "unavailable", reason: "upstream_unavailable", retryable: false };
  }
  return { errorClass: "unavailable", reason: "unexpected_status", retryable: false };
}
