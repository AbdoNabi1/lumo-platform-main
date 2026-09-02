import type { Principal } from "@platform/contracts";
import type { ReviewsController } from "@platform/reviews";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface ReviewsAdminControllerDeps {
  readonly reviews: ReviewsController;
  readonly guard: AdminGuard;
}

/** Wires the Reviews admin screen to the Reviews context (Sprint S1). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class ReviewsAdminController {
  private readonly reviews: ReviewsController;
  private readonly guard: AdminGuard;

  constructor(deps: ReviewsAdminControllerDeps) {
    this.reviews = deps.reviews;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<ReviewsController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reviews:create");
    if (denied) return denied;
    return this.reviews.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<ReviewsController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reviews:advance");
    if (denied) return denied;
    return this.reviews.advance(input);
  }

  async vote(
    principal: Principal,
    input: Parameters<ReviewsController["vote"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reviews:vote");
    if (denied) return denied;
    return this.reviews.vote(input);
  }

  async report(
    principal: Principal,
    input: Parameters<ReviewsController["report"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reviews:report");
    if (denied) return denied;
    return this.reviews.report(input);
  }

  async respond(
    principal: Principal,
    input: Parameters<ReviewsController["respond"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reviews:respond");
    if (denied) return denied;
    return this.reviews.respond(input);
  }

  async moderate(
    principal: Principal,
    input: Parameters<ReviewsController["moderate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reviews:moderate");
    if (denied) return denied;
    return this.reviews.moderate(input);
  }

  async list(
    principal: Principal,
    input: Parameters<ReviewsController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reviews:read");
    if (denied) return denied;
    return this.reviews.list(input);
  }

  async get(
    principal: Principal,
    input: Parameters<ReviewsController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reviews:read");
    if (denied) return denied;
    return this.reviews.get(input);
  }

  async listByProduct(
    principal: Principal,
    input: Parameters<ReviewsController["listByProduct"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reviews:read");
    if (denied) return denied;
    return this.reviews.listByProduct(input);
  }
}
