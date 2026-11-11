import type {
  GetAccessStatus,
  GetPublicAccess,
  UpdateAccess,
  UpdateAccessInput,
  VerifyStorefrontPassword,
} from "../application/access.use-cases";
import type {
  GetPreferences,
  UpdatePreferences,
  UpdatePreferencesInput,
} from "../application/preferences.use-cases";
import type {
  GeneratePolicyTemplate,
  GetPolicy,
  GetPublicPolicy,
  ListPolicies,
  UpdatePolicy,
  UpdatePolicyInput,
} from "../application/policies.use-cases";
import type {
  SearchLinkTargets,
  SearchLinkTargetsInput,
} from "../application/link-targets.use-case";
import type {
  CreateMenu,
  CreateMenuInput,
  DeleteMenu,
  GetMenu,
  ListMenus,
  UpdateMenu,
  UpdateMenuInput,
} from "../application/menus.use-cases";
import type { GetStorefrontHome } from "../application/home.use-case";
import type { IssuePreviewToken } from "../application/preview.use-cases";
import type { GetStorefrontShell } from "../application/shell.use-case";
import type {
  DiscardThemeDraft,
  GetTheme,
  ListThemeReleases,
  PublishTheme,
  RestoreThemeRelease,
  SaveThemeDraft,
} from "../application/theme.use-cases";
import type { Locale, PolicyType } from "@platform/storefront-content";
import { err } from "@platform/types";
import { policyNotFound } from "../domain/errors";
import { plainError, present, type ControllerResponse } from "./presenter";

export interface OnlineStoreControllerDeps {
  readonly getPreferences: GetPreferences;
  readonly updatePreferences: UpdatePreferences;
  readonly getAccessStatus: GetAccessStatus;
  readonly updateAccess: UpdateAccess;
  readonly getPublicAccess: GetPublicAccess;
  readonly verifyPassword: VerifyStorefrontPassword;
  readonly getTheme: GetTheme;
  readonly saveThemeDraft: SaveThemeDraft;
  readonly discardThemeDraft: DiscardThemeDraft;
  readonly publishTheme: PublishTheme;
  readonly listThemeReleases: ListThemeReleases;
  readonly restoreThemeRelease: RestoreThemeRelease;
  readonly issuePreviewToken: IssuePreviewToken;
  readonly getShell: GetStorefrontShell;
  readonly getHome: GetStorefrontHome;
  readonly listPolicies: ListPolicies;
  readonly getPolicy: GetPolicy;
  readonly updatePolicy: UpdatePolicy;
  readonly generatePolicyTemplate: GeneratePolicyTemplate;
  readonly getPublicPolicy: GetPublicPolicy;
  readonly listMenus: ListMenus;
  readonly getMenu: GetMenu;
  readonly createMenu: CreateMenu;
  readonly updateMenu: UpdateMenu;
  readonly deleteMenu: DeleteMenu;
  readonly searchLinkTargets: SearchLinkTargets;
}

type Tenant = { readonly tenantId: string };

/** Framework-agnostic boundary (no HTTP). Admin methods are guarded by apps/admin; public ones are not. */
export class OnlineStoreController {
  constructor(private readonly deps: OnlineStoreControllerDeps) {}

  async getPreferences(input: Tenant): Promise<ControllerResponse> {
    return present(await this.deps.getPreferences.execute(input), 200);
  }
  async updatePreferences(input: UpdatePreferencesInput): Promise<ControllerResponse> {
    return present(await this.deps.updatePreferences.execute(input), 200);
  }
  async getAccess(input: Tenant): Promise<ControllerResponse> {
    return present(await this.deps.getAccessStatus.execute(input), 200);
  }
  async updateAccess(input: UpdateAccessInput): Promise<ControllerResponse> {
    return present(await this.deps.updateAccess.execute(input), 200);
  }
  async getTheme(input: Tenant): Promise<ControllerResponse> {
    return present(await this.deps.getTheme.execute(input), 200);
  }
  async saveThemeDraft(
    input: { readonly document: unknown; readonly expectedVersion: number } & Tenant,
  ): Promise<ControllerResponse> {
    return present(await this.deps.saveThemeDraft.execute(input), 200);
  }
  async discardThemeDraft(
    input: { readonly expectedVersion: number } & Tenant,
  ): Promise<ControllerResponse> {
    return present(await this.deps.discardThemeDraft.execute(input), 200);
  }
  async publishTheme(
    input: { readonly expectedDraftRevision: number; readonly by: string } & Tenant,
  ): Promise<ControllerResponse> {
    return present(await this.deps.publishTheme.execute(input), 200);
  }
  async listThemeReleases(input: Tenant): Promise<ControllerResponse> {
    return present(await this.deps.listThemeReleases.execute(input), 200);
  }
  async restoreThemeRelease(
    input: { readonly releaseNumber: number; readonly expectedVersion: number } & Tenant,
  ): Promise<ControllerResponse> {
    return present(await this.deps.restoreThemeRelease.execute(input), 200);
  }
  async issuePreviewToken(
    input: { readonly createdBy: string } & Tenant,
  ): Promise<ControllerResponse> {
    return present(await this.deps.issuePreviewToken.execute(input), 201);
  }

  async listPolicies(input: Tenant): Promise<ControllerResponse> {
    return present(await this.deps.listPolicies.execute(input), 200);
  }
  async getPolicy(input: { readonly type: PolicyType } & Tenant): Promise<ControllerResponse> {
    return present(await this.deps.getPolicy.execute(input), 200);
  }
  async updatePolicy(input: UpdatePolicyInput): Promise<ControllerResponse> {
    return present(await this.deps.updatePolicy.execute(input), 200);
  }
  /** Pure: returns starting text for the editor; nothing is saved (spec decision 41). */
  generatePolicyTemplate(input: {
    readonly type: PolicyType;
    readonly locale: Locale;
    readonly inputs: unknown;
  }): Promise<ControllerResponse> {
    return Promise.resolve(present(this.deps.generatePolicyTemplate.execute(input), 200));
  }

  async listMenus(input: Tenant): Promise<ControllerResponse> {
    return present(await this.deps.listMenus.execute(input), 200);
  }
  async getMenu(input: { readonly handle: string } & Tenant): Promise<ControllerResponse> {
    return present(await this.deps.getMenu.execute(input), 200);
  }
  async createMenu(input: CreateMenuInput): Promise<ControllerResponse> {
    return present(await this.deps.createMenu.execute(input), 201);
  }
  async updateMenu(input: UpdateMenuInput): Promise<ControllerResponse> {
    return present(await this.deps.updateMenu.execute(input), 200);
  }
  async deleteMenu(input: { readonly handle: string } & Tenant): Promise<ControllerResponse> {
    return present(await this.deps.deleteMenu.execute(input), 200);
  }
  /** The menu editor's link picker: at most 20 choices. */
  async searchLinkTargets(input: SearchLinkTargetsInput): Promise<ControllerResponse> {
    return present(await this.deps.searchLinkTargets.execute(input), 200);
  }

  /** Public: the storefront shell; a bad preview token is 401 PREVIEW_INVALID (the storefront falls back to live). */
  async shell(input: { readonly previewToken?: string } & Tenant): Promise<ControllerResponse> {
    const outcome = await this.deps.getShell.execute(input);
    if (outcome.kind === "preview_invalid")
      return plainError(401, "PREVIEW_INVALID", "Preview link is invalid or expired");
    return { status: 200, body: outcome.shell };
  }
  /** Public: the homepage sections resolved (Part 3); a bad preview token is the shell's 401. */
  async home(input: { readonly previewToken?: string } & Tenant): Promise<ControllerResponse> {
    const outcome = await this.deps.getHome.execute(input);
    if (outcome.kind === "preview_invalid")
      return plainError(401, "PREVIEW_INVALID", "Preview link is invalid or expired");
    return { status: 200, body: outcome.home };
  }
  /** Public: one policy as stored; 404 POLICY_NOT_FOUND when it is not set. */
  async publicPolicy(input: { readonly type: PolicyType } & Tenant): Promise<ControllerResponse> {
    const view = await this.deps.getPublicPolicy.execute(input);
    return view === null ? present(err(policyNotFound()), 200) : { status: 200, body: view };
  }
  async publicAccess(input: Tenant): Promise<ControllerResponse> {
    return { status: 200, body: await this.deps.getPublicAccess.execute(input) };
  }
  /** Public: one uniform 401 for wrong password, no lock and no hash. */
  async unlock(input: { readonly password: string } & Tenant): Promise<ControllerResponse> {
    const result = await this.deps.verifyPassword.execute(input);
    return result.ok
      ? { status: 200, body: { accessVersion: result.accessVersion } }
      : plainError(401, "PASSWORD_INCORRECT", "Incorrect password");
  }
}
