import type { Principal } from "@platform/contracts";
import { AuthorizationError } from "@platform/utils";
import { err, ok, type Result } from "@platform/types";
import type { SecurityPort } from "./ports";

export interface AuthorizeOptions {
  readonly requireStepUp?: boolean;
}

/**
 * Every Finance command's Security gate: permission check → optional step-up → signed WORM
 * audit — no bypass (ADR-0024, ADR-0023). Fails closed: any `false`/exception becomes a deny,
 * and the deny is still recorded to the audit trail before returning.
 */
export async function authorize(
  security: SecurityPort,
  principal: Principal,
  permission: string,
  occurredAt: Date,
  metadata: Readonly<Record<string, string>> = {},
  options: AuthorizeOptions = {},
): Promise<Result<void, AuthorizationError>> {
  const allowed = await security.authorize(principal, permission);
  const steppedUp = !options.requireStepUp || (await security.hasSteppedUp(principal.id));
  const decision = allowed && steppedUp ? "allow" : "deny";

  await security.record({
    principalId: principal.id,
    principalKind: principal.kind,
    permission,
    decision,
    occurredAt: occurredAt.toISOString(),
    metadata,
  });

  if (decision === "deny") {
    return err(
      new AuthorizationError(
        !allowed ? `Principal lacks permission "${permission}"` : "Step-up authentication required",
      ),
    );
  }
  return ok(undefined);
}
