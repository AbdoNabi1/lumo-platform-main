/**
 * Outbound port for the two emails a signup attempt can trigger (G-72, D4): the "complete your
 * account" link for a guest email, and a "you already have an account, log in" notice for an
 * email that's already fully registered. Both are dispatched from
 * `CustomerAuthAdminController.requestSignup` AFTER it has already decided which one applies —
 * this port only sends, it never branches.
 *
 * `services/notifications`' own `create -> queue -> send` lifecycle was checked first (D4) and
 * deliberately NOT reused here: its 4 provider ports are permanent, environment-unaware in-memory
 * stubs (documented in `NotificationsWiringDeps`'s own doc comment as "out of scope for C-01") —
 * there is nothing there to guard "real" from "stub", so building on it would silently inherit
 * that already-open gap instead of closing this one. This port exists specifically so it CAN be
 * guarded (see `apps/runtime/src/api.ts`'s `assertProductionSignupEmailConfigured`).
 */
export interface SignupEmailPort {
  /**
   * Wave 2b2 (D51): whether this store can send sign-up mail at all (it has a working email
   * connection). False means the sign-up flow answers 503 EMAIL_NOT_CONNECTED and nothing is sent.
   * Never a fallback to the platform's account.
   */
  isAvailable(tenantId: string): Promise<boolean>;

  sendCompleteAccountEmail(input: {
    readonly email: string;
    readonly link: string;
    readonly tenantId: string;
  }): Promise<void>;

  sendAlreadyRegisteredEmail(input: {
    readonly email: string;
    readonly tenantId: string;
  }): Promise<void>;
}
