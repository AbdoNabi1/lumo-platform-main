import { z } from "zod";
import type { RateLimiter } from "@platform/contracts";
import type { TransportResponse } from "@platform/http";
import { logger } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import {
  CHALLENGE_EXPIRED,
  type VerifiedChallenge,
} from "../interfaces/staff-auth.admin-controller";
import { rateLimited } from "./rate-limited-response";

/** The body of both verify routes (staff and merchant): the sign-in challenge and the typed code. */
export const loginVerifyBody = z
  .object({
    challenge: z.string().min(1).max(4096),
    code: z.string().min(1).max(32),
  })
  .strict();

/** Six tries per member in ten minutes, counted on every attempt (a right code included). */
const MFA_ATTEMPT_LIMIT = 6;
const MFA_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
/** A challenge may finish a sign-in once. */
const CHALLENGE_BURN_LIMIT = 1;
const CHALLENGE_BURN_WINDOW_MS = 10 * 60 * 1000;
/** When the limiter itself is down the answer is "slow down", never "come in". */
const LIMITER_DOWN_RETRY_MS = 60_000;

interface Spent {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
  /** The limiter itself failed (nothing was decided). */
  readonly down: boolean;
}

/**
 * Spends one unit of `key`. A limiter failure FAILS CLOSED (`allowed: false, down: true`): this is a
 * credential endpoint, so no verdict is better than a free guess.
 */
async function spend(
  rateLimiter: RateLimiter,
  key: string,
  limit: number,
  windowMs: number,
): Promise<Spent> {
  try {
    const decision = await rateLimiter.consume(key, limit, windowMs);
    return { allowed: decision.allowed, retryAfterMs: decision.retryAfterMs, down: false };
  } catch {
    logger.warn("rate limiter unavailable on the sign-in code step; refusing the attempt");
    return { allowed: false, retryAfterMs: LIMITER_DOWN_RETRY_MS, down: true };
  }
}

/**
 * The code step of a staff or merchant sign-in, shared by both public routes.
 *
 * `requestTenantId` is set by the staff route: the challenge (signed by this server when the password
 * was right) must belong to the tenant the request addresses, else it is just expired. The merchant
 * route passes none: its challenge was issued for the store the merchant's email resolved to, and the
 * platform-tenant gate has already run.
 *
 * Order matters: parse the challenge → attempt limit (per member, from the SIGNED claims, consumed
 * before the code is looked at) → check the code → burn the challenge → only then a session. A
 * challenge that already finished a sign-in answers CHALLENGE_EXPIRED without making another one.
 * `rateLimiter` undefined ⇒ no limits (tests), like the password login routes.
 */
export async function finishStaffLogin(options: {
  readonly admin: WiredAdmin;
  readonly rateLimiter?: RateLimiter;
  readonly body: z.infer<typeof loginVerifyBody>;
  readonly requestTenantId?: string;
}): Promise<TransportResponse> {
  const { admin, rateLimiter, body, requestTenantId } = options;
  const claims = await admin.staffAuth.readChallenge(body.challenge);
  if (claims === null) return CHALLENGE_EXPIRED;
  if (requestTenantId !== undefined && claims.tenantId !== requestTenantId) {
    return CHALLENGE_EXPIRED;
  }

  if (rateLimiter !== undefined) {
    const attempt = await spend(
      rateLimiter,
      `rl:${claims.tenantId}:staff-mfa:${claims.sub}`,
      MFA_ATTEMPT_LIMIT,
      MFA_ATTEMPT_WINDOW_MS,
    );
    if (!attempt.allowed) {
      return rateLimited(attempt.retryAfterMs, "Too many attempts. Wait a few minutes.");
    }
  }

  const refused = await admin.staffAuth.checkLoginCode(claims, body.code);
  if (refused !== null) return refused;

  if (rateLimiter !== undefined) {
    const burn = await spend(
      rateLimiter,
      `rl:mfa-chal:${claims.jti}`,
      CHALLENGE_BURN_LIMIT,
      CHALLENGE_BURN_WINDOW_MS,
    );
    if (!burn.allowed) {
      // A limiter outage is a 429 (nothing was decided); a spent bucket means the challenge was used.
      return burn.down
        ? rateLimited(burn.retryAfterMs, "Too many attempts. Wait a few minutes.")
        : CHALLENGE_EXPIRED;
    }
  }
  return admin.staffAuth.completeLogin(claims);
}

/** Wave 1f: the body of the setup-at-sign-in start routes (staff and merchant). */
export const setupStartBody = z.object({ setupChallenge: z.string().min(1).max(4096) }).strict();

/** The body of the setup-at-sign-in confirm routes: the setup challenge, the enrolment it started, the first code. */
export const setupConfirmBody = z
  .object({
    setupChallenge: z.string().min(1).max(4096),
    enrollmentId: z.string().uuid(),
    code: z.string().min(1).max(32),
  })
  .strict();

/** Six starts and six confirms per member in ten minutes (separate buckets: a typo never costs a restart). */
const SETUP_ATTEMPT_LIMIT = 6;
const SETUP_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
/** A setup challenge lives 600 s (+30 s tolerance): its burn outlives it. */
const SETUP_BURN_LIMIT = 1;
const SETUP_BURN_WINDOW_MS = 15 * 60 * 1000;
const TOO_MANY = "Too many attempts. Wait a few minutes.";

/**
 * The signed claims of a live setup challenge, tenant rule applied exactly like {@link finishStaffLogin}:
 * the staff routes pass the request's tenant (the challenge must belong to it), the merchant routes pass
 * none (the platform-tenant gate has run; the challenge names the store). `null` = just "expired".
 */
async function setupClaims(
  admin: WiredAdmin,
  setupChallenge: string,
  requestTenantId: string | undefined,
): Promise<VerifiedChallenge | null> {
  const claims = await admin.staffAuth.readSetupChallenge(setupChallenge);
  if (claims === null) return null;
  if (requestTenantId !== undefined && claims.tenantId !== requestTenantId) return null;
  return claims;
}

interface SetupOptions<B> {
  readonly admin: WiredAdmin;
  readonly rateLimiter?: RateLimiter;
  readonly body: B;
  readonly requestTenantId?: string;
}

/** Spends one unit of the member's bucket; the 429 when it is gone or the limiter is down (fail closed). */
async function setupAttempt(
  rateLimiter: RateLimiter | undefined,
  claims: VerifiedChallenge,
  bucket: string,
): Promise<TransportResponse | null> {
  if (rateLimiter === undefined) return null;
  const attempt = await spend(
    rateLimiter,
    `rl:${claims.tenantId}:${bucket}:${claims.sub}`,
    SETUP_ATTEMPT_LIMIT,
    SETUP_ATTEMPT_WINDOW_MS,
  );
  return attempt.allowed ? null : rateLimited(attempt.retryAfterMs, TOO_MANY);
}

/** Setup at sign-in, step 1: the key and link for the member named by a live setup challenge (201, no-store). */
export async function startStaffSetup(
  options: SetupOptions<z.infer<typeof setupStartBody>>,
): Promise<TransportResponse> {
  const { admin, rateLimiter, body, requestTenantId } = options;
  const claims = await setupClaims(admin, body.setupChallenge, requestTenantId);
  if (claims === null) return CHALLENGE_EXPIRED;
  const limited = await setupAttempt(rateLimiter, claims, "staff-mfa-setup-start");
  if (limited !== null) return limited;
  return admin.staffAuth.startSetup(claims);
}

/**
 * Setup at sign-in, step 2. Order: parse the challenge → attempt limit (per member, from the SIGNED claims,
 * before the code is looked at) → confirm the first code (wrong → the uniform 401) → burn the challenge →
 * only then a session (+ the backup codes, ONCE, no-store). A challenge that already finished a setup is
 * just expired.
 */
export async function confirmStaffSetup(
  options: SetupOptions<z.infer<typeof setupConfirmBody>>,
): Promise<TransportResponse> {
  const { admin, rateLimiter, body, requestTenantId } = options;
  const claims = await setupClaims(admin, body.setupChallenge, requestTenantId);
  if (claims === null) return CHALLENGE_EXPIRED;
  const limited = await setupAttempt(rateLimiter, claims, "staff-mfa-setup");
  if (limited !== null) return limited;

  const confirmed = await admin.staffAuth.confirmSetup(claims, body);
  if ("refused" in confirmed) return confirmed.refused;

  if (rateLimiter !== undefined) {
    const burn = await spend(
      rateLimiter,
      `rl:mfa-setup:${claims.jti}`,
      SETUP_BURN_LIMIT,
      SETUP_BURN_WINDOW_MS,
    );
    if (!burn.allowed) {
      return burn.down ? rateLimited(burn.retryAfterMs, TOO_MANY) : CHALLENGE_EXPIRED;
    }
  }
  return admin.staffAuth.completeSetupLogin(claims, confirmed.backupCodes);
}
