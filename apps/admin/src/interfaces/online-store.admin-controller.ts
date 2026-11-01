import type { Permission, Principal } from "@platform/contracts";
import type { OnlineStoreController } from "@platform/online-store";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface OnlineStoreAdminControllerDeps {
  readonly onlineStore: OnlineStoreController;
  readonly guard: AdminGuard;
}

type In<K extends keyof OnlineStoreController> = Parameters<OnlineStoreController[K]>[0];

/** Online Store screens → Online Store (Project 4). Each action authorizes, then delegates. */
export class OnlineStoreAdminController {
  private readonly onlineStore: OnlineStoreController;
  private readonly guard: AdminGuard;

  constructor(deps: OnlineStoreAdminControllerDeps) {
    this.onlineStore = deps.onlineStore;
    this.guard = deps.guard;
  }

  private async run(
    principal: Principal,
    permission: Permission,
    action: () => Promise<AdminResponse>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, permission);
    return denied ?? action();
  }

  getPreferences(p: Principal, input: In<"getPreferences">): Promise<AdminResponse> {
    return this.run(p, "online_store:read", () => this.onlineStore.getPreferences(input));
  }
  updatePreferences(p: Principal, input: In<"updatePreferences">): Promise<AdminResponse> {
    return this.run(p, "online_store:update_preferences", () =>
      this.onlineStore.updatePreferences(input),
    );
  }
  getAccess(p: Principal, input: In<"getAccess">): Promise<AdminResponse> {
    return this.run(p, "online_store:read", () => this.onlineStore.getAccess(input));
  }
  updateAccess(p: Principal, input: In<"updateAccess">): Promise<AdminResponse> {
    return this.run(p, "online_store_admin:update_access", () =>
      this.onlineStore.updateAccess(input),
    );
  }
  getTheme(p: Principal, input: In<"getTheme">): Promise<AdminResponse> {
    return this.run(p, "online_store:read", () => this.onlineStore.getTheme(input));
  }
  saveThemeDraft(p: Principal, input: In<"saveThemeDraft">): Promise<AdminResponse> {
    return this.run(p, "online_store:edit_theme", () => this.onlineStore.saveThemeDraft(input));
  }
  discardThemeDraft(p: Principal, input: In<"discardThemeDraft">): Promise<AdminResponse> {
    return this.run(p, "online_store:edit_theme", () => this.onlineStore.discardThemeDraft(input));
  }
  publishTheme(p: Principal, input: In<"publishTheme">): Promise<AdminResponse> {
    return this.run(p, "online_store_admin:publish_theme", () =>
      this.onlineStore.publishTheme(input),
    );
  }
  listThemeReleases(p: Principal, input: In<"listThemeReleases">): Promise<AdminResponse> {
    return this.run(p, "online_store:read", () => this.onlineStore.listThemeReleases(input));
  }
  restoreThemeRelease(p: Principal, input: In<"restoreThemeRelease">): Promise<AdminResponse> {
    return this.run(p, "online_store_admin:publish_theme", () =>
      this.onlineStore.restoreThemeRelease(input),
    );
  }
  issuePreviewToken(p: Principal, input: In<"issuePreviewToken">): Promise<AdminResponse> {
    return this.run(p, "online_store:read", () => this.onlineStore.issuePreviewToken(input));
  }
}
