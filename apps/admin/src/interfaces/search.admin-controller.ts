import type { Principal } from "@platform/contracts";
import type { SearchController } from "@platform/search";
import type { CursorPage } from "@platform/types";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface SearchAdminControllerDeps {
  readonly search: SearchController;
  readonly guard: AdminGuard;
}

/** Wires the Search admin screen to the Search context (Sprint S1). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class SearchAdminController {
  private readonly search: SearchController;
  private readonly guard: AdminGuard;

  constructor(deps: SearchAdminControllerDeps) {
    this.search = deps.search;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<SearchController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "search:create");
    if (denied) return denied;
    return this.search.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<SearchController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "search:advance");
    if (denied) return denied;
    return this.search.advance(input);
  }

  async upsertDocument(
    principal: Principal,
    input: Parameters<SearchController["upsertDocument"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "search:upsert_document");
    if (denied) return denied;
    return this.search.upsertDocument(input);
  }

  async deleteDocument(
    principal: Principal,
    input: Parameters<SearchController["deleteDocument"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "search:delete_document");
    if (denied) return denied;
    return this.search.deleteDocument(input);
  }

  async addSynonym(
    principal: Principal,
    input: Parameters<SearchController["addSynonym"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "search:add_synonym");
    if (denied) return denied;
    return this.search.addSynonym(input);
  }

  async removeSynonym(
    principal: Principal,
    input: Parameters<SearchController["removeSynonym"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "search:remove_synonym");
    if (denied) return denied;
    return this.search.removeSynonym(input);
  }

  async addSuggestion(
    principal: Principal,
    input: Parameters<SearchController["addSuggestion"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "search:add_suggestion");
    if (denied) return denied;
    return this.search.addSuggestion(input);
  }

  async logQuery(
    principal: Principal,
    input: Parameters<SearchController["logQuery"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "search:log_query");
    if (denied) return denied;
    return this.search.logQuery(input);
  }

  async list(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "search:read");
    if (denied) return denied;
    return this.search.list(input);
  }

  async get(
    principal: Principal,
    input: Parameters<SearchController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "search:read");
    if (denied) return denied;
    return this.search.get(input);
  }
}
