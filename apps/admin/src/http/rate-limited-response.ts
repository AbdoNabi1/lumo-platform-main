/** The 429 every public route with its own limit answers, with the header clients back off on. */
export function rateLimited(retryAfterMs: number, message: string) {
  return {
    status: 429,
    body: { code: "RATE_LIMITED", message, retryable: true, fields: [], retryAfterMs },
    headers: { "retry-after": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
  };
}
