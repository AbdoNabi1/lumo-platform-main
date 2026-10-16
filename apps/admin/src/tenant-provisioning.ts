import {
  OWNER_GRANT,
  PLATFORM_ADMIN_ROLE,
  SYSTEM_GRANTOR,
  bootstrapSecurity,
  type SecurityController,
  type TenantBaselineState,
} from "@platform/security";
import type { Logger } from "@platform/utils";

/**
 * T10.6 (Gap 2): provisioning a tenant means giving it a security baseline it can be administered
 * with — not writing a row. This runs `bootstrapSecurity` FOR THAT TENANT (the same function the
 * runtime's boot path uses; it always took the tenant as an argument) and then, when an owner is named,
 * makes that owner an administrator.
 *
 * **Idempotent and resumable, because it converges on STORED state.** Provisioning is several
 * independent writes and partly external (the enforcement grant reaches Ory Keto later, through
 * `security.relation.written` and the relation-sync consumer), so it cannot be one transaction.
 * Instead every step is safe to repeat: the baseline use-cases upsert by key, `registerPrincipal` is
 * per external id, and the two owner steps are skipped when the stored state already shows them — so a
 * second run neither duplicates a role nor grants twice, and a run interrupted anywhere is finished by
 * simply running it again.
 *
 * **Completeness is READ, not inferred.** The report's `complete` comes from `tenantBaseline` — what is
 * stored after the run — never from "no step threw". A step that returned success but wrote nothing
 * leaves the tenant reported incomplete. A half-provisioned tenant is therefore visibly half-provisioned
 * (`complete: false`, `missing` names the steps, `error` says why), from any process, at any later time.
 *
 * What "complete" does NOT claim: that Keto already holds the grant. The tuple is stored in Security and
 * its event is durable in the outbox; propagation is asynchronous and is the relay's and the consumer's
 * job, so its lag is observable there, not here.
 *
 * Concurrency: repeated calls for one tenant within a process share one run. Two API instances running
 * it for the same tenant at the same instant can still race on the owner's role assignment (the assign
 * use-case is not upsert-by-key); the operator route is the only caller, so this is recorded, not solved.
 */

export type ProvisioningStepName =
  | "roles"
  | "policy"
  | "profile"
  | "owner-principal"
  | "owner-admin-role"
  | "owner-enforcement-grant";

export interface ProvisioningStep {
  readonly name: ProvisioningStepName;
  readonly done: boolean;
  readonly error?: string;
}

export interface ProvisioningReport {
  readonly tenantId: string;
  /** True only when every step is present in STORED state. Never true on a partial tenant. */
  readonly complete: boolean;
  readonly steps: readonly ProvisioningStep[];
  readonly missing: readonly ProvisioningStepName[];
  readonly owner: TenantBaselineState["owner"];
}

export interface ProvisionOptions {
  /** The first administrator (an Identity user id). Omitted ⇒ baseline only. */
  readonly ownerExternalId?: string;
}

export interface TenantProvisionerDeps {
  readonly security: SecurityController;
  readonly logger: Logger;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class TenantProvisioner {
  private readonly running = new Map<string, Promise<ProvisioningReport>>();

  constructor(private readonly deps: TenantProvisionerDeps) {}

  /** Runs (or finishes) provisioning. Never throws for a step failure — it reports it. */
  provision(tenantId: string, options: ProvisionOptions = {}): Promise<ProvisioningReport> {
    const key = `${tenantId}\u0000${options.ownerExternalId ?? ""}`;
    const existing = this.running.get(key);
    if (existing !== undefined) return existing;
    const run = this.run(tenantId, options).finally(() => this.running.delete(key));
    this.running.set(key, run);
    return run;
  }

  /** Reports what is stored for the tenant right now; writes nothing. */
  async inspect(tenantId: string, options: ProvisionOptions = {}): Promise<ProvisioningReport> {
    return this.report(tenantId, options, new Map());
  }

  private async run(tenantId: string, options: ProvisionOptions): Promise<ProvisioningReport> {
    const errors = new Map<ProvisioningStepName, string>();
    const { security, logger } = this.deps;

    try {
      await bootstrapSecurity(security, tenantId, logger);
    } catch (error) {
      const reason = message(error);
      logger.error("tenant provisioning: baseline failed", { tenantId, error: reason });
      for (const step of ["roles", "policy", "profile"] as const) errors.set(step, reason);
    }

    const owner = options.ownerExternalId;
    if (owner !== undefined) {
      const state = await security.tenantBaseline(tenantId, owner);
      const attempt = async (
        step: ProvisioningStepName,
        needed: boolean,
        act: () => Promise<{ status: number; body: unknown }>,
      ): Promise<void> => {
        if (!needed) return;
        try {
          const response = await act();
          if (response.status >= 300) {
            throw new Error(`status ${response.status}: ${JSON.stringify(response.body)}`);
          }
        } catch (error) {
          errors.set(step, message(error));
          logger.error("tenant provisioning: owner step failed", {
            tenantId,
            step,
            error: message(error),
          });
        }
      };

      await attempt("owner-principal", !state.owner?.registered, () =>
        security.registerPrincipal({
          tenantId,
          externalId: owner,
          kind: "human",
          displayName: owner,
          subjectRef: owner,
          tenantRef: tenantId,
        }),
      );
      // The role assignment needs the principal: with none, skip it rather than record a second error.
      if (!errors.has("owner-principal")) {
        await attempt("owner-admin-role", (state.owner?.adminAssignments ?? 0) === 0, () =>
          security.assignRole({
            tenantId,
            principalExternalId: owner,
            roleKey: PLATFORM_ADMIN_ROLE,
            grantedBy: SYSTEM_GRANTOR,
          }),
        );
      }
      await attempt("owner-enforcement-grant", (state.owner?.enforcementGrants ?? 0) === 0, () =>
        security.writeRelationTuple({
          tenantId,
          namespace: OWNER_GRANT.namespace,
          object: OWNER_GRANT.object,
          relation: OWNER_GRANT.relation,
          subject: owner,
        }),
      );
    }

    return this.report(tenantId, options, errors);
  }

  private async report(
    tenantId: string,
    options: ProvisionOptions,
    errors: ReadonlyMap<ProvisioningStepName, string>,
  ): Promise<ProvisioningReport> {
    const state = await this.deps.security.tenantBaseline(tenantId, options.ownerExternalId);
    const presence: [ProvisioningStepName, boolean][] = [
      ["roles", state.roles],
      ["policy", state.policy],
      ["profile", state.profile],
    ];
    if (state.owner !== null) {
      presence.push(
        ["owner-principal", state.owner.registered],
        ["owner-admin-role", state.owner.adminAssignments > 0],
        ["owner-enforcement-grant", state.owner.enforcementGrants > 0],
      );
    }
    const steps: ProvisioningStep[] = presence.map(([name, done]) => {
      const error = errors.get(name);
      return { name, done, ...(done || error === undefined ? {} : { error }) };
    });
    const missing = steps.filter((s) => !s.done).map((s) => s.name);
    return { tenantId, complete: missing.length === 0, steps, missing, owner: state.owner };
  }
}
