import { randomBytes } from "node:crypto";
import type { NativeTokenIssuer } from "@platform/auth";
import type { Clock } from "@platform/contracts";
import type {
  PasswordCredentialStore,
  PasswordRegistrar,
  PasswordResetService,
  SecurityController,
} from "@platform/security";
import { ValidationError, toErrorEnvelope } from "@platform/utils";
import { passwordResetEmail } from "../infrastructure/email-templates";
import type { AdminResponse } from "./admin-response";
import type { EmailSender } from "./email-sender.port";

/** Staff logins live in their own identifier namespace so a shop's customer and staff never collide. */
export const STAFF_IDENTIFIER_PREFIX = "staff:";

export function staffIdentifier(email: string): string {
  return `${STAFF_IDENTIFIER_PREFIX}${email.trim().toLowerCase()}`;
}

/** Security's baseline owner role and the dashboard's three roles (packages/auth RoleTableAccessControl). */
export const TOKEN_ROLE: Readonly<Record<string, string>> = {
  "platform-admin": "admin",
  admin: "admin",
  operator: "operator",
  viewer: "viewer",
};

const UNAUTHENTICATED: AdminResponse = {
  status: 401,
  body: { error: { code: "UNAUTHENTICATED", message: "Invalid email or password" } },
};
const NOT_CONFIGURED: AdminResponse = {
  status: 503,
  body: { error: { code: "NOT_CONFIGURED", message: "Native staff sign-in is not configured" } },
};

/**
 * G7: every failed code check answers with this ONE body — a wrong code, a code outside the window, a
 * reused step, no active enrolment and an unknown or deactivated member are indistinguishable.
 */
const INVALID_CODE: AdminResponse = {
  status: 401,
  body: { error: { code: "INVALID_CODE", message: "That code didn't work. Try again." } },
};
/** An expired, forged, wrong-tenant or already-used sign-in challenge. */
export const CHALLENGE_EXPIRED: AdminResponse = {
  status: 401,
  body: { error: { code: "CHALLENGE_EXPIRED", message: "Your sign-in expired. Start again." } },
};
const INVALID_PASSWORD: AdminResponse = {
  status: 401,
  body: { code: "INVALID_PASSWORD", message: "That password is incorrect" },
};

/** G4: a response that may carry a secret or backup codes must never be stored by a cache. */
function noStore(response: AdminResponse): AdminResponse {
  return { ...response, headers: { ...response.headers, "cache-control": "private, no-store" } };
}

/** What a verified sign-in challenge says (signed by this server, so trusted). */
export interface VerifiedChallenge {
  readonly sub: string;
  readonly tenantId: string;
  readonly email: string;
  readonly jti: string;
}

export interface StaffAuthAdminControllerDeps {
  readonly security: SecurityController;
  readonly issuer?: NativeTokenIssuer;
  readonly sessionTtlSeconds: number;
  /** Wave 1e: the `now` handed to the code checks (the replay guard works on the TOTP time step). */
  readonly clock: Clock;
  /** Plan 1C: forgot-password. Absent ⇒ the request endpoint still answers 202 and sends nothing. */
  readonly passwordReset?: PasswordResetService;
  readonly emailSender?: EmailSender;
  readonly adminPublicUrl?: string;
  /** Plan 1C: change-password (the durable provider's registrar and credential store). */
  readonly passwordRegistrar?: PasswordRegistrar;
  readonly credentialStore?: PasswordCredentialStore;
}

const RESET_SENT: AdminResponse = { status: 202, body: { outcome: "sent-if-exists" } };

/** Plan 1B-2: native staff sign-in — password (Plan 1B-1 provider) → session → role keys → token. */
export class StaffAuthAdminController {
  private readonly deps: StaffAuthAdminControllerDeps;
  private passwordMethodReady: Promise<void> | undefined;

  constructor(deps: StaffAuthAdminControllerDeps) {
    this.deps = deps;
  }

  async login(input: {
    readonly tenantId: string;
    readonly email: string;
    readonly password: string;
  }): Promise<AdminResponse> {
    const issuer = this.deps.issuer;
    if (issuer === undefined) return NOT_CONFIGURED;
    await this.ensurePasswordMethod(input.tenantId);
    const outcome = await this.deps.security.authenticate({
      tenantId: input.tenantId,
      method: "password",
      identifier: staffIdentifier(input.email),
      credential: input.password,
      sessionTtlSeconds: this.deps.sessionTtlSeconds,
      // Wave 1e: someone with two-step on gets no session from the password alone.
      requireEnrolledFactor: true,
    });
    if (outcome.status < 200 || outcome.status >= 300) return UNAUTHENTICATED;
    const result = outcome.body as {
      readonly authenticated: boolean;
      readonly principalExternalId: string | null;
      readonly sessionId: string | null;
      readonly mfaRequirement: string;
      readonly hasActiveEnrollment: boolean;
    };
    if (result.authenticated && result.sessionId === null) {
      return this.codeRequired(issuer, input, result);
    }
    if (!result.authenticated || result.sessionId === null) return UNAUTHENTICATED;
    return this.issueSession(
      issuer,
      input.tenantId,
      result.sessionId,
      input.email.trim().toLowerCase(),
    );
  }

  /**
   * The password was right but no session was made. A member with two-step on gets a signed,
   * short-lived challenge to bring to the code step; anyone else (the store requires two-step and they
   * have none, or a step-up) gets the plain 403 with nothing to continue with.
   */
  private async codeRequired(
    issuer: NativeTokenIssuer,
    input: { readonly tenantId: string; readonly email: string },
    result: {
      readonly principalExternalId: string | null;
      readonly mfaRequirement: string;
      readonly hasActiveEnrollment: boolean;
    },
  ): Promise<AdminResponse> {
    if (!result.hasActiveEnrollment || result.principalExternalId === null) {
      return {
        status: 403,
        body: {
          error: {
            code: "MFA_REQUIRED",
            message: "An additional authentication factor is required",
          },
          mfaRequirement: result.mfaRequirement,
        },
      };
    }
    const challenge = await issuer.issueChallenge({
      sub: result.principalExternalId,
      tenantId: input.tenantId,
      email: input.email.trim().toLowerCase(),
    });
    return {
      status: 403,
      body: {
        error: { code: "MFA_REQUIRED", message: "Enter the code from your authenticator app" },
        mfaRequirement: result.mfaRequirement,
        challenge: challenge.token,
        challengeExpiresIn: challenge.expiresIn,
      },
    };
  }

  /** The tail of every sign-in: introspect the session → role keys → mapped roles → the staff token. */
  private async issueSession(
    issuer: NativeTokenIssuer,
    tenantId: string,
    sessionId: string,
    email: string,
  ): Promise<AdminResponse> {
    const subject = await this.deps.security.introspectSessionSubject({ tenantId, sessionId });
    const principalExternalId = (subject.body as { principalExternalId: string | null })
      .principalExternalId;
    if (principalExternalId === null) return UNAUTHENTICATED;

    const listed = await this.deps.security.listPrincipalRoleKeys({
      tenantId,
      principalExternalId,
    });
    const roles = [
      ...new Set(
        ((listed.body as { roleKeys?: readonly string[] }).roleKeys ?? [])
          .map((key) => TOKEN_ROLE[key])
          .filter((role): role is string => role !== undefined),
      ),
    ];
    if (roles.length === 0) return UNAUTHENTICATED; // a customer, or staff with no role yet

    const { token, expiresIn } = await issuer.issue({
      sub: principalExternalId,
      tenantId,
      kind: "staff",
      roles,
      sid: sessionId,
      email,
    });
    return { status: 200, body: { accessToken: token, tokenType: "Bearer", expiresIn } };
  }

  /** The signed claims of a live sign-in challenge of ours, or null for anything else. */
  async readChallenge(challenge: string): Promise<VerifiedChallenge | null> {
    const issuer = this.deps.issuer;
    if (issuer === undefined) return null;
    return issuer.verifyChallenge(challenge);
  }

  /**
   * Is `code` right for this member? `null` = yes (the code is spent now); otherwise the ONE uniform
   * 401. The route limits attempts around this and burns the challenge between it and
   * {@link completeLogin}.
   */
  async checkLoginCode(claims: VerifiedChallenge, code: string): Promise<AdminResponse | null> {
    const checked = await this.deps.security.verifyMfaLogin({
      tenantId: claims.tenantId,
      principalExternalId: claims.sub,
      code,
      now: this.deps.clock.now(),
    });
    return checked.status === 200 ? null : INVALID_CODE;
  }

  /**
   * A session for the verified member, then the same token a password-only sign-in issues. The role
   * check re-reads the member's roles, so someone left without any role in between gets 401 and the
   * session made for them is revoked straight away.
   */
  async completeLogin(claims: VerifiedChallenge): Promise<AdminResponse> {
    const issuer = this.deps.issuer;
    if (issuer === undefined) return NOT_CONFIGURED;
    const established = await this.deps.security.establishSession({
      tenantId: claims.tenantId,
      principalExternalId: claims.sub,
      refreshFingerprint: randomBytes(24).toString("base64url"),
      ttlSeconds: this.deps.sessionTtlSeconds,
    });
    if (established.status !== 201) return UNAUTHENTICATED;
    const sessionId = (established.body as { id: string }).id;
    const issued = await this.issueSession(issuer, claims.tenantId, sessionId, claims.email);
    if (issued.status !== 200) {
      await this.deps.security.revokeSession({ tenantId: claims.tenantId, sessionId });
    }
    return issued;
  }

  /** The whole code step for a caller that applies no limit of its own (the routes use the parts). */
  async verifyLoginCode(input: {
    readonly challenge: string;
    readonly code: string;
  }): Promise<AdminResponse> {
    const claims = await this.readChallenge(input.challenge);
    if (claims === null) return CHALLENGE_EXPIRED;
    return (await this.checkLoginCode(claims, input.code)) ?? (await this.completeLogin(claims));
  }

  /** Wave 1e: the signed-in member's own two-step status. */
  async twoStepStatus(tenantId: string, principalExternalId: string): Promise<AdminResponse> {
    return noStore(await this.deps.security.getOwnTwoStep({ tenantId, principalExternalId }));
  }

  /** Starts (or restarts) a setup. The secret is in the response ONCE: never cached, never replayed. */
  async startTwoStep(tenantId: string, principalExternalId: string): Promise<AdminResponse> {
    const { credentialStore } = this.deps;
    if (credentialStore === undefined) return NOT_CONFIGURED;
    const email = await this.staffEmailOf(credentialStore, tenantId, principalExternalId);
    if (email === null) return UNAUTHENTICATED;
    return noStore(
      await this.deps.security.startOwnTwoStep({ tenantId, principalExternalId, email }),
    );
  }

  async confirmTwoStep(input: {
    readonly tenantId: string;
    readonly principalExternalId: string;
    readonly enrollmentId: string;
    readonly code: string;
  }): Promise<AdminResponse> {
    return noStore(
      await this.deps.security.confirmOwnTwoStep({ ...input, now: this.deps.clock.now() }),
    );
  }

  async regenerateBackupCodes(input: {
    readonly tenantId: string;
    readonly principalExternalId: string;
    readonly code: string;
  }): Promise<AdminResponse> {
    return noStore(
      await this.deps.security.regenerateOwnBackupCodes({
        ...input,
        now: this.deps.clock.now(),
      }),
    );
  }

  /**
   * Turning two-step off needs the account password: re-verified here, through the same provider
   * sign-in uses, before Security is asked. With two-step on the check makes no session; the rare
   * session it makes for someone who has none is revoked again.
   */
  async disableTwoStep(input: {
    readonly tenantId: string;
    readonly principalExternalId: string;
    readonly password: string;
  }): Promise<AdminResponse> {
    const { credentialStore } = this.deps;
    if (credentialStore === undefined) return NOT_CONFIGURED;
    const credential = await credentialStore.findByPrincipal(
      input.tenantId,
      input.principalExternalId,
    );
    if (credential === null || !credential.identifier.startsWith(STAFF_IDENTIFIER_PREFIX)) {
      return UNAUTHENTICATED;
    }
    await this.ensurePasswordMethod(input.tenantId);
    const verified = await this.deps.security.authenticate({
      tenantId: input.tenantId,
      method: "password",
      identifier: credential.identifier,
      credential: input.password,
      sessionTtlSeconds: this.deps.sessionTtlSeconds,
      requireEnrolledFactor: true,
    });
    const body = verified.body as { authenticated?: boolean; sessionId?: string | null };
    const sessionId = body.sessionId ?? null;
    if (sessionId !== null) {
      await this.deps.security.revokeSession({ tenantId: input.tenantId, sessionId });
    }
    if (verified.status < 200 || verified.status >= 300 || body.authenticated !== true) {
      return INVALID_PASSWORD;
    }
    return this.deps.security.disableOwnTwoStep({
      tenantId: input.tenantId,
      principalExternalId: input.principalExternalId,
      now: this.deps.clock.now(),
    });
  }

  /**
   * Plan 1C: ALWAYS 202 with the same body — whether the account exists, whether the email provider
   * worked, whether anything is configured — so the endpoint reveals nothing about who has an account.
   */
  async requestPasswordReset(input: {
    readonly tenantId: string;
    readonly email: string;
    /** Merchant resets: the store the link must complete against (`&store=<id>`). */
    readonly storeId?: string;
  }): Promise<AdminResponse> {
    const { passwordReset, emailSender, adminPublicUrl } = this.deps;
    if (passwordReset === undefined || emailSender === undefined || adminPublicUrl === undefined) {
      return RESET_SENT;
    }
    try {
      const issued = await passwordReset.request(input.tenantId, staffIdentifier(input.email));
      if (issued !== null) {
        const origin = adminPublicUrl.replace(/\/$/, "");
        const store =
          input.storeId === undefined ? "" : `&store=${encodeURIComponent(input.storeId)}`;
        const link = `${origin}/reset-password?token=${encodeURIComponent(issued.token)}${store}`;
        await emailSender.send({
          to: input.email.trim().toLowerCase(),
          ...passwordResetEmail(link),
        });
      }
    } catch {
      // A store or provider failure must not change the answer: a 500 only for real accounts would
      // tell them apart (no enumeration). The token, if one was stored, simply expires.
    }
    return RESET_SENT;
  }

  async completePasswordReset(input: {
    readonly tenantId: string;
    readonly token: string;
    readonly password: string;
  }): Promise<AdminResponse> {
    if (this.deps.passwordReset === undefined) return NOT_CONFIGURED;
    try {
      const done = await this.deps.passwordReset.complete(
        input.tenantId,
        input.token,
        input.password,
      );
      return done
        ? { status: 200, body: { outcome: "reset" } }
        : {
            status: 400,
            body: {
              error: { code: "INVALID_TOKEN", message: "This link is invalid or has expired" },
            },
          };
    } catch (error) {
      if (error instanceof ValidationError) return { status: 422, body: toErrorEnvelope(error) };
      throw error;
    }
  }

  async changePassword(input: {
    readonly tenantId: string;
    readonly principalExternalId: string;
    readonly currentPassword: string;
    readonly newPassword: string;
  }): Promise<AdminResponse> {
    const { credentialStore, passwordRegistrar } = this.deps;
    if (credentialStore === undefined || passwordRegistrar === undefined) return NOT_CONFIGURED;
    const credential = await credentialStore.findByPrincipal(
      input.tenantId,
      input.principalExternalId,
    );
    if (credential === null || !credential.identifier.startsWith(STAFF_IDENTIFIER_PREFIX)) {
      return UNAUTHENTICATED;
    }
    await this.ensurePasswordMethod(input.tenantId);
    const verified = await this.deps.security.authenticate({
      tenantId: input.tenantId,
      method: "password",
      identifier: credential.identifier,
      credential: input.currentPassword,
      sessionTtlSeconds: this.deps.sessionTtlSeconds,
      // Reads only `authenticated`: with two-step on this makes no stray session (no code is asked).
      requireEnrolledFactor: true,
    });
    if (
      verified.status < 200 ||
      verified.status >= 300 ||
      (verified.body as { authenticated?: boolean }).authenticated !== true
    ) {
      return UNAUTHENTICATED;
    }
    try {
      await passwordRegistrar.setPassword({
        tenantId: input.tenantId,
        identifier: credential.identifier,
        password: input.newPassword,
        principalExternalId: input.principalExternalId,
      });
    } catch (error) {
      if (error instanceof ValidationError) return { status: 422, body: toErrorEnvelope(error) };
      throw error;
    }
    return { status: 200, body: { outcome: "changed" } };
  }

  async jwks(): Promise<AdminResponse> {
    if (this.deps.issuer === undefined) return NOT_CONFIGURED;
    return { status: 200, body: await this.deps.issuer.jwks() };
  }

  /** The member's sign-in email (the `staff:` credential), or `null` when they have none. */
  private async staffEmailOf(
    credentialStore: PasswordCredentialStore,
    tenantId: string,
    principalExternalId: string,
  ): Promise<string | null> {
    const credential = await credentialStore.findByPrincipal(tenantId, principalExternalId);
    if (credential === null || !credential.identifier.startsWith(STAFF_IDENTIFIER_PREFIX)) {
      return null;
    }
    return credential.identifier.slice(STAFF_IDENTIFIER_PREFIX.length);
  }

  private ensurePasswordMethod(tenantId: string): Promise<void> {
    this.passwordMethodReady ??= (async () => {
      const authMethods = this.deps.security
        .registryExplorer()
        .registries.find((registry) => registry.name === "auth-methods");
      if (authMethods?.entries.some((entry) => entry.key === "password") ?? false) return;
      await this.deps.security.registerAuthMethod({
        tenantId,
        kind: "password",
        displayName: "Password",
      });
    })();
    return this.passwordMethodReady;
  }
}
