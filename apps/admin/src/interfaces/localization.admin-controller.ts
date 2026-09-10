import type { Principal } from "@platform/contracts";
import type { LocalizationController } from "@platform/localization";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface LocalizationAdminControllerDeps {
  readonly localization: LocalizationController;
  readonly guard: AdminGuard;
}

/** Wires the Localization admin screen to the Localization context (Sprint 5.4). Pure delegation. */
export class LocalizationAdminController {
  private readonly localization: LocalizationController;
  private readonly guard: AdminGuard;

  constructor(deps: LocalizationAdminControllerDeps) {
    this.localization = deps.localization;
    this.guard = deps.guard;
  }

  async createLocale(
    principal: Principal,
    input: Parameters<LocalizationController["createLocale"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "localization:create_locale");
    if (denied) return denied;
    return this.localization.createLocale(input);
  }

  async createTranslationSet(
    principal: Principal,
    input: Parameters<LocalizationController["createTranslationSet"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "localization:create_set");
    if (denied) return denied;
    return this.localization.createTranslationSet(input);
  }

  async setTranslation(
    principal: Principal,
    input: Parameters<LocalizationController["setTranslation"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "localization:set_translation");
    if (denied) return denied;
    return this.localization.setTranslation(input);
  }

  async publishTranslation(
    principal: Principal,
    input: Parameters<LocalizationController["publishTranslation"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "localization:publish_translation");
    if (denied) return denied;
    return this.localization.publishTranslation(input);
  }

  async listLocales(
    principal: Principal,
    input: Parameters<LocalizationController["listLocales"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "localization:read");
    if (denied) return denied;
    return this.localization.listLocales(input);
  }

  async getLocale(
    principal: Principal,
    input: Parameters<LocalizationController["getLocale"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "localization:read");
    if (denied) return denied;
    return this.localization.getLocale(input);
  }

  async listTranslationSets(
    principal: Principal,
    input: Parameters<LocalizationController["listTranslationSets"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "localization:read");
    if (denied) return denied;
    return this.localization.listTranslationSets(input);
  }

  async getTranslationSet(
    principal: Principal,
    input: Parameters<LocalizationController["getTranslationSet"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "localization:read");
    if (denied) return denied;
    return this.localization.getTranslationSet(input);
  }
}
