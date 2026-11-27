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

/** The ceiling for the setup challenge cookie (the server's is 600 s). */
export const MAX_SETUP_CHALLENGE_SECONDS = 600;

/**
 * Wave 1f — what a sign-in 403 `MFA_SETUP_REQUIRED` carries: a short-lived SETUP challenge for a member
 * who has no two-step yet while the platform requires it. It only ever lives in an httpOnly cookie.
 */
export interface MfaSetupChallenge {
  readonly setupChallenge: string;
  readonly setupChallengeExpiresIn?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * `error.code` of the nested envelope, else the flat `code`. The wire has both shapes:
 * MFA_SETUP_REQUIRED / MFA_REQUIRED / INVALID_CODE / CHALLENGE_EXPIRED are nested; TWO_STEP_REQUIRED,
 * RATE_LIMITED and the 409 / 503 envelopes are flat.
 */
export function errorCodeOf(body: unknown): string | undefined {
  const record = asRecord(body);
  const nested = asRecord(record["error"])["code"];
  const code = nested ?? record["code"];
  return typeof code === "string" ? code : undefined;
}

/** The setup challenge of a 403 `MFA_SETUP_REQUIRED` body, or `null` when it names none (or none usable). */
export function readMfaSetupChallenge(body: unknown): MfaSetupChallenge | null {
  if (errorCodeOf(body) !== "MFA_SETUP_REQUIRED") return null;
  const record = asRecord(body);
  const setupChallenge = record["setupChallenge"];
  const expiresIn = record["setupChallengeExpiresIn"];
  if (typeof setupChallenge !== "string" || setupChallenge.length === 0) return null;
  if (setupChallenge.length > 4096) return null;
  return {
    setupChallenge,
    ...(typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
      ? { setupChallengeExpiresIn: Math.min(Math.floor(expiresIn), MAX_SETUP_CHALLENGE_SECONDS) }
      : {}),
  };
}
