import type { Principal } from "@platform/contracts";
import type { NotificationsController } from "@platform/notifications";
import type { CursorPage } from "@platform/types";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface NotificationsAdminControllerDeps {
  readonly notifications: NotificationsController;
  readonly guard: AdminGuard;
}

/**
 * Wires the **Notifications** admin screen to the Notifications context (Sprint 4.12 —
 * Notifications' first admin wiring). Pure delegation over the 6 backoffice-relevant actions
 * (create/queue/send/retry/transitions/callback), per
 * `SPRINT_4_12_NOTIFICATIONS_CORE_REPORT.md` §2's "6 versioned zod routes". Every action
 * authorizes the acting principal first (RBAC seam, ADR-0007; permissive until real RBAC lands).
 */
export class NotificationsAdminController {
  private readonly notifications: NotificationsController;
  private readonly guard: AdminGuard;

  constructor(deps: NotificationsAdminControllerDeps) {
    this.notifications = deps.notifications;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<NotificationsController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "notifications:create");
    if (denied) return denied;
    return this.notifications.create(input);
  }

  async queue(
    principal: Principal,
    input: Parameters<NotificationsController["queue"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "notifications:queue");
    if (denied) return denied;
    return this.notifications.queue(input);
  }

  async send(
    principal: Principal,
    input: Parameters<NotificationsController["send"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "notifications:send");
    if (denied) return denied;
    return this.notifications.send(input);
  }

  async retry(
    principal: Principal,
    input: Parameters<NotificationsController["retry"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "notifications:retry");
    if (denied) return denied;
    return this.notifications.retry(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<NotificationsController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "notifications:advance");
    if (denied) return denied;
    return this.notifications.advance(input);
  }

  async callback(
    principal: Principal,
    input: Parameters<NotificationsController["callback"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "notifications:callback");
    if (denied) return denied;
    return this.notifications.callback(input);
  }

  async list(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "notifications:read");
    if (denied) return denied;
    return this.notifications.list(input);
  }

  async get(
    principal: Principal,
    input: Parameters<NotificationsController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "notifications:read");
    if (denied) return denied;
    return this.notifications.get(input);
  }
}
