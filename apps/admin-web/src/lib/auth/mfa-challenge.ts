/**
 * Wave 1e — what a sign-in 403 `MFA_REQUIRED` may carry for the code step. The runtime sends
 * `challenge` and `challengeExpiresIn` only for a member who has two-step turned on; anyone else
 * (the store requires it and they have none) gets the plain 403. Pure: shared by the staff and the
 * merchant sign-in helpers.
 */
export interface MfaChallenge {
  readonly challenge?: string;
  readonly challengeExpiresIn?: number;
}

/** The ceiling for the challenge cookie's lifetime, whatever the server says (the server's is 300 s). */
export const MAX_CHALLENGE_SECONDS = 600;

export function readMfaChallenge(body: unknown): MfaChallenge {
  if (typeof body !== "object" || body === null) return {};
  const record = body as Record<string, unknown>;
  const challenge = record["challenge"];
  const expiresIn = record["challengeExpiresIn"];
  if (typeof challenge !== "string" || challenge.length === 0 || challenge.length > 4096) return {};
  return {
    challenge,
    ...(typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
      ? { challengeExpiresIn: Math.min(Math.floor(expiresIn), MAX_CHALLENGE_SECONDS) }
      : {}),
  };
}
