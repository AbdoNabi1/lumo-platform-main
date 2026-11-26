import type { Principal } from "@platform/contracts";
import type { NotificationSettingsController } from "@platform/notifications";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface NotificationSettingsAdminControllerDeps {
  readonly settings: NotificationSettingsController;
  readonly guard: AdminGuard;
  /**
   * The signed-in staff member's OWN sign-in email, resolved server-side from the principal (the
   * `staff:` credential). The only address a test email may ever go to.
   */
  readonly actorEmail: (tenantId: string, principalExternalId: string) => Promise<string | null>;
}

/**
 * Wave 2b: Settings > Notifications. Reading is `settings:read`, every change and the test mail are
 * `settings:update` (admin-level, like the other Settings pages). Pure delegation after the guard.
 */
export class NotificationSettingsAdminController {
  private readonly settings: NotificationSettingsController;
  private readonly guard: AdminGuard;
  private readonly actorEmail: NotificationSettingsAdminControllerDeps["actorEmail"];

  constructor(deps: NotificationSettingsAdminControllerDeps) {
    this.settings = deps.settings;
    this.guard = deps.guard;
    this.actorEmail = deps.actorEmail;
  }

  async getSettings(
    principal: Principal,
    input: Parameters<NotificationSettingsController["getSettings"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:read");
    if (denied) return denied;
    return this.settings.getSettings(input);
  }

  async updateSettings(
    principal: Principal,
    input: Parameters<NotificationSettingsController["updateSettings"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.settings.updateSettings(input);
  }

  async listTemplates(
    principal: Principal,
    input: Parameters<NotificationSettingsController["listTemplates"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:read");
    if (denied) return denied;
    return this.settings.listTemplates(input);
  }

  async getTemplate(
    principal: Principal,
    input: Parameters<NotificationSettingsController["getTemplate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:read");
    if (denied) return denied;
    return this.settings.getTemplate(input);
  }

  async putTemplate(
    principal: Principal,
    input: Parameters<NotificationSettingsController["putTemplate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.settings.putTemplate(input);
  }

  async revertTemplate(
    principal: Principal,
    input: Parameters<NotificationSettingsController["revertTemplate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.settings.revertTemplate(input);
  }

  async previewTemplate(
    principal: Principal,
    input: Parameters<NotificationSettingsController["previewTemplate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:read");
    if (denied) return denied;
    return this.settings.previewTemplate(input);
  }

  /** The mail goes to the acting member's own address, never to one named in the request. */
  async sendTest(
    principal: Principal,
    input: Omit<Parameters<NotificationSettingsController["sendTest"]>[0], "actorEmail">,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    const actorEmail = await this.actorEmail(input.tenantId, principal.id);
    return this.settings.sendTest({ ...input, actorEmail });
  }
}
