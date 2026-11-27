import type { Clock, Principal } from "@platform/contracts";
import {
  parseSegmentConditions,
  type CustomerSegmentController,
  type SegmentCondition,
  type SegmentView,
} from "@platform/identity";
import { isAppError, toErrorEnvelope } from "@platform/utils";
import type {
  CustomerSegmentQuery,
  SegmentMembersInput,
} from "../infrastructure/cross-context/customer-segment-query";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";
import type { TenancyAdminController } from "./tenancy.admin-controller";

export interface CustomerSegmentsAdminControllerDeps {
  readonly segments: CustomerSegmentController;
  readonly query: CustomerSegmentQuery;
  /**
   * Only the shop's currency and zone are read from tenancy. Typed as that one method so the
   * composition can hand in a closure: the multi-tenant boot check walks the composed graph for
   * construction-time tenant ids and exempts only the root `tenancy` (ADR-0014 8f), so a direct
   * reference to the tenancy controller held here would trip it.
   */
  readonly tenancy: Pick<TenancyAdminController, "getStoreRegion">;
  readonly guard: AdminGuard;
  readonly clock: Clock;
}

/** The size of the preview's first page when the editor does not ask for one. */
export const DEFAULT_PREVIEW_PAGE_SIZE = 10;

interface Paging {
  readonly first: number;
  readonly after?: string;
  readonly search?: string;
}

/**
 * Wave 1c — Customers > Segments for the admin API. Definitions (list/get/create/update/delete)
 * are Identity's; membership is the live SQL read of {@link CustomerSegmentQuery}, counted in the
 * shop's currency and time zone. Every method authorizes the acting principal first:
 * `customers:read` for reads, `customers:manage_segments` for writes (the operator holds it
 * through `customers:*`, a viewer does not).
 */
export class CustomerSegmentsAdminController {
  private readonly segments: CustomerSegmentController;
  private readonly query: CustomerSegmentQuery;
  private readonly tenancy: Pick<TenancyAdminController, "getStoreRegion">;
  private readonly guard: AdminGuard;
  private readonly clock: Clock;

  constructor(deps: CustomerSegmentsAdminControllerDeps) {
    this.segments = deps.segments;
    this.query = deps.query;
    this.tenancy = deps.tenancy;
    this.guard = deps.guard;
    this.clock = deps.clock;
  }

  async list(
    principal: Principal,
    input: Parameters<CustomerSegmentController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:read");
    if (denied) return denied;
    return this.segments.list(input);
  }

  async get(
    principal: Principal,
    input: Parameters<CustomerSegmentController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:read");
    if (denied) return denied;
    return this.segments.get(input);
  }

  /** The author is the acting principal, never a body field. */
  async create(
    principal: Principal,
    input: Omit<Parameters<CustomerSegmentController["create"]>[0], "createdBy">,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:manage_segments");
    if (denied) return denied;
    return this.segments.create({ ...input, createdBy: principal.id });
  }

  async update(
    principal: Principal,
    input: Parameters<CustomerSegmentController["update"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:manage_segments");
    if (denied) return denied;
    return this.segments.update(input);
  }

  async delete(
    principal: Principal,
    input: Parameters<CustomerSegmentController["delete"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:manage_segments");
    if (denied) return denied;
    return this.segments.delete(input);
  }

  /**
   * The currency the segment editor's money fields are in. Authorized as `customers:read` (the
   * people who see segments), not `settings:read`; only the currency leaves the store settings.
   * A failed read is answered as is — a guessed currency would turn 29 into the wrong amount.
   */
  async storeCurrency(principal: Principal, tenantId: string): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:read");
    if (denied) return denied;
    const region = await this.tenancy.getStoreRegion(principal, tenantId);
    if (region.status !== 200) return region;
    return { status: 200, body: { currency: (region.body as { currency: string }).currency } };
  }

  /** One page of the members of a saved or default segment, with the live total. */
  async members(
    principal: Principal,
    input: { readonly tenantId: string; readonly segmentId: string } & Paging,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:read");
    if (denied) return denied;
    const segment = await this.segments.get({
      tenantId: input.tenantId,
      segmentId: input.segmentId,
    });
    if (segment.status !== 200) return segment;
    const { conditions } = segment.body as SegmentView;
    return this.membersOf(principal, input.tenantId, conditions, {
      first: input.first,
      ...(input.after === undefined ? {} : { after: input.after }),
      ...(input.search === undefined ? {} : { search: input.search }),
    });
  }

  /**
   * The editor's live preview: the conditions are validated first (422 with the field paths
   * `conditions`, `conditions.<i>.<field>`) and nothing is saved or read until they are valid.
   */
  async preview(
    principal: Principal,
    input: {
      readonly tenantId: string;
      readonly conditions: unknown;
      readonly first?: number;
    },
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:read");
    if (denied) return denied;
    const parsed = parseSegmentConditions(input.conditions);
    if (!parsed.ok) return { status: 422, body: toErrorEnvelope(parsed.error) };
    return this.membersOf(principal, input.tenantId, parsed.value, {
      first: input.first ?? DEFAULT_PREVIEW_PAGE_SIZE,
    });
  }

  /** The shop's zone and currency, then the live read; `UNAVAILABLE` (no database) is a 503. */
  private async membersOf(
    principal: Principal,
    tenantId: string,
    conditions: readonly SegmentCondition[],
    paging: Paging,
  ): Promise<AdminResponse> {
    const region = await this.tenancy.getStoreRegion(principal, tenantId);
    if (region.status !== 200) return region;
    const { currency, timezone } = region.body as { currency: string; timezone: string };
    const request: SegmentMembersInput = {
      tenantId,
      conditions,
      currency,
      timezone,
      now: this.clock.now(),
      first: paging.first,
      ...(paging.after === undefined ? {} : { after: paging.after }),
      ...(paging.search === undefined ? {} : { search: paging.search }),
    };
    try {
      return { status: 200, body: await this.query.members(request) };
    } catch (error) {
      if (isAppError(error) && error.code === "UNAVAILABLE") {
        return { status: 503, body: toErrorEnvelope(error) };
      }
      throw error;
    }
  }
}
