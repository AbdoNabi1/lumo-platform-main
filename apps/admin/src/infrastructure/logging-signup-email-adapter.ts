import { logger } from "@platform/utils";
import type { SignupEmailPort } from "../interfaces/signup-email.port";

/**
 * The ONLY `SignupEmailPort` adapter this codebase ships (G-72, D4): logs instead of sending.
 * A real provider (Resend/SendGrid/SES/...) is deliberately out of scope — "the user's choice",
 * per the brief — and must be wired before `APP_ENV` leaves `local`; see
 * `apps/runtime/src/api.ts`'s `assertProductionSignupEmailConfigured`, which fails closed on this
 * exact class outside `local`, mirroring `InMemoryTotpMfaProvider`'s guard.
 */
export class LoggingSignupEmailAdapter implements SignupEmailPort {
  async sendCompleteAccountEmail(input: {
    readonly email: string;
    readonly link: string;
    readonly tenantId: string;
  }): Promise<void> {
    logger.info("signup: complete-account email (dev adapter, not actually sent)", input);
  }

  async sendAlreadyRegisteredEmail(input: {
    readonly email: string;
    readonly tenantId: string;
  }): Promise<void> {
    logger.info("signup: already-registered email (dev adapter, not actually sent)", input);
  }
}
