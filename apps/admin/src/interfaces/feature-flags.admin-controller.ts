import type { Principal } from "@platform/contracts";
import type { FeatureFlagsController } from "@platform/feature-flags-service";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface FeatureFlagsAdminControllerDeps {
  readonly featureFlags: FeatureFlagsController;
  readonly guard: AdminGuard;
}

/** Wires the Feature Flags admin screen to the Feature Flags context (Sprint S1). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class FeatureFlagsAdminController {
  private readonly featureFlags: FeatureFlagsController;
  private readonly guard: AdminGuard;

  constructor(deps: FeatureFlagsAdminControllerDeps) {
    this.featureFlags = deps.featureFlags;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<FeatureFlagsController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_flags:create");
    if (denied) return denied;
    return this.featureFlags.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<FeatureFlagsController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_flags:advance");
    if (denied) return denied;
    return this.featureFlags.advance(input);
  }

  async setRollout(
    principal: Principal,
    input: Parameters<FeatureFlagsController["setRollout"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_flags:set_rollout");
    if (denied) return denied;
    return this.featureFlags.setRollout(input);
  }

  async addRule(
    principal: Principal,
    input: Parameters<FeatureFlagsController["addRule"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_flags:add_rule");
    if (denied) return denied;
    return this.featureFlags.addRule(input);
  }

  async setEnvironmentOverride(
    principal: Principal,
    input: Parameters<FeatureFlagsController["setEnvironmentOverride"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_flags:set_environment_override");
    if (denied) return denied;
    return this.featureFlags.setEnvironmentOverride(input);
  }

  async list(
    principal: Principal,
    input: Parameters<FeatureFlagsController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_flags:read");
    if (denied) return denied;
    return this.featureFlags.list(input);
  }

  async get(
    principal: Principal,
    input: Parameters<FeatureFlagsController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_flags:read");
    if (denied) return denied;
    return this.featureFlags.get(input);
  }
}
