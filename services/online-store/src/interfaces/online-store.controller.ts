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

  /** Public: the storefront shell; a bad preview token is 401 PREVIEW_INVALID (the storefront falls back to live). */
  async shell(input: { readonly previewToken?: string } & Tenant): Promise<ControllerResponse> {
    const outcome = await this.deps.getShell.execute(input);
    if (outcome.kind === "preview_invalid")
      return plainError(401, "PREVIEW_INVALID", "Preview link is invalid or expired");
    return { status: 200, body: outcome.shell };
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
