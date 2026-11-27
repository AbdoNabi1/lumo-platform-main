import type { Principal } from "@platform/contracts";
import type { EmailConnectionController } from "@platform/notifications";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface EmailConnectionAdminControllerDeps {
  readonly emailConnection: EmailConnectionController;
  readonly guard: AdminGuard;
  /**
   * The signed-in staff member's OWN sign-in email, resolved server-side from the principal. The only
   * address a connection test mail may ever go to: it is never a request field.
   */
  readonly actorEmail: (tenantId: string, principalExternalId: string) => Promise<string | null>;
}

/**
 * Wave 2b2: the store's own email account (Settings > Notifications > Email account). Reading is
 * `settings:read`; connecting, switching, testing and disconnecting are `settings:update` (admin-level,
 * like the other Settings pages). Pure delegation after the guard; the tenant is always the request's.
 */
export class EmailConnectionAdminController {
  private readonly emailConnection: EmailConnectionController;
  private readonly guard: AdminGuard;
  private readonly actorEmail: EmailConnectionAdminControllerDeps["actorEmail"];

  constructor(deps: EmailConnectionAdminControllerDeps) {
    this.emailConnection = deps.emailConnection;
    this.guard = deps.guard;
    this.actorEmail = deps.actorEmail;
  }

  async get(
    principal: Principal,
    input: Parameters<EmailConnectionController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:read");
    if (denied) return denied;
    return this.emailConnection.get(input);
  }

  async save(
    principal: Principal,
    input: Omit<Parameters<EmailConnectionController["save"]>[0], "actorEmail">,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    const actorEmail = await this.actorEmail(input.tenantId, principal.id);
    return this.emailConnection.save({ ...input, actorEmail });
  }

  async setEnabled(
    principal: Principal,
    input: Parameters<EmailConnectionController["setEnabled"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.emailConnection.setEnabled(input);
  }

  async remove(
    principal: Principal,
    input: Parameters<EmailConnectionController["remove"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.emailConnection.remove(input);
  }

  /** The test mail goes to the acting member's own address, never to one named in the request. */
  async test(
    principal: Principal,
    input: Omit<Parameters<EmailConnectionController["test"]>[0], "actorEmail">,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    const actorEmail = await this.actorEmail(input.tenantId, principal.id);
    return this.emailConnection.test({ ...input, actorEmail });
  }
}
