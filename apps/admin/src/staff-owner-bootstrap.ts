import { randomUUID } from "node:crypto";
import { PLATFORM_ADMIN_ROLE, SYSTEM_GRANTOR, bootstrapSecurity } from "@platform/security";
import type { Logger } from "@platform/utils";
import type { WiredAdmin } from "./composition";
import { staffIdentifier } from "./interfaces/staff-auth.admin-controller";

export interface BootstrapStaffOwnerInput {
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
  readonly logger: Logger;
}

const expectOk = (response: { status: number; body: unknown }, step: string): void => {
  if (response.status >= 300) {
    throw new Error(`owner bootstrap step "${step}" failed with status ${response.status}`);
  }
};

/**
 * Plan 1B-2: creates the first owner from BOOTSTRAP_OWNER_EMAIL/PASSWORD (runtime env), once.
 * Idempotent by the stored credential: a second boot with the same env does nothing. The password
 * is never logged; the owner removes BOOTSTRAP_OWNER_PASSWORD from the env after first sign-in.
 */
export async function bootstrapStaffOwner(
  admin: WiredAdmin,
  input: BootstrapStaffOwnerInput,
): Promise<"created" | "exists"> {
  const identifier = staffIdentifier(input.email);
  if (await admin.securityWiring.passwordRegistrar.hasCredential(input.tenantId, identifier)) {
    input.logger.info("owner bootstrap: owner already exists", { tenantId: input.tenantId });
    return "exists";
  }

  const security = admin.securityWiring.security;
  await bootstrapSecurity(security, input.tenantId, input.logger);
  const externalId = randomUUID();
  admin.securityWiring.identityDirectory.register(externalId);
  expectOk(
    await security.registerPrincipal({
      tenantId: input.tenantId,
      externalId,
      kind: "human",
      displayName: input.email.trim().toLowerCase(),
      subjectRef: externalId,
    }),
    "registerPrincipal",
  );
  await admin.securityWiring.passwordRegistrar.setPassword({
    tenantId: input.tenantId,
    identifier,
    password: input.password,
    principalExternalId: externalId,
  });
  expectOk(
    await security.assignRole({
      tenantId: input.tenantId,
      principalExternalId: externalId,
      roleKey: PLATFORM_ADMIN_ROLE,
      grantedBy: SYSTEM_GRANTOR,
    }),
    "assignRole",
  );
  input.logger.info("owner bootstrap: owner created", { tenantId: input.tenantId });
  return "created";
}
