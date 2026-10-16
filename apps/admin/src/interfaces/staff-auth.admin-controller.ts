import type { NativeTokenIssuer } from "@platform/auth";
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
const TOKEN_ROLE: Readonly<Record<string, string>> = {
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

export interface StaffAuthAdminControllerDeps {
  readonly security: SecurityController;
  readonly issuer?: NativeTokenIssuer;
  readonly sessionTtlSeconds: number;
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
    });
    if (outcome.status < 200 || outcome.status >= 300) return UNAUTHENTICATED;
    const result = outcome.body as {
      readonly authenticated: boolean;
      readonly sessionId: string | null;
      readonly mfaRequirement: string;
    };
    if (result.authenticated && result.sessionId === null) {
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
    if (!result.authenticated || result.sessionId === null) return UNAUTHENTICATED;

    const subject = await this.deps.security.introspectSessionSubject({
      tenantId: input.tenantId,
      sessionId: result.sessionId,
    });
    const principalExternalId = (subject.body as { principalExternalId: string | null })
      .principalExternalId;
    if (principalExternalId === null) return UNAUTHENTICATED;

    const listed = await this.deps.security.listPrincipalRoleKeys({
      tenantId: input.tenantId,
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
      tenantId: input.tenantId,
      kind: "staff",
      roles,
      sid: result.sessionId,
      email: input.email.trim().toLowerCase(),
    });
    return { status: 200, body: { accessToken: token, tokenType: "Bearer", expiresIn } };
  }

  /**
   * Plan 1C: ALWAYS 202 with the same body — whether the account exists, whether the email provider
   * worked, whether anything is configured — so the endpoint reveals nothing about who has an account.
   */
  async requestPasswordReset(input: {
    readonly tenantId: string;
    readonly email: string;
  }): Promise<AdminResponse> {
    const { passwordReset, emailSender, adminPublicUrl } = this.deps;
    if (passwordReset === undefined || emailSender === undefined || adminPublicUrl === undefined) {
      return RESET_SENT;
    }
    try {
      const issued = await passwordReset.request(input.tenantId, staffIdentifier(input.email));
      if (issued !== null) {
        const origin = adminPublicUrl.replace(/\/$/, "");
        const link = `${origin}/reset-password?token=${encodeURIComponent(issued.token)}`;
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
