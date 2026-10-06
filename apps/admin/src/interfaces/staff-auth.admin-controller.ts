import type { NativeTokenIssuer } from "@platform/auth";
import type { SecurityController } from "@platform/security";
import type { AdminResponse } from "./admin-response";

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
}

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
