import type {
  GetPublicAdPlatforms,
  ListConnections,
  SaveConnection,
  SaveConnectionInput,
} from "../application/connections.use-cases";
import { err, type Result } from "@platform/types";
import { type DomainError, UnexpectedError } from "@platform/utils";
import { type ControllerResponse, present } from "./presenter";

export interface ConnectionsControllerDeps {
  readonly listConnections: ListConnections;
  readonly saveConnection: SaveConnection;
  readonly getPublicAdPlatforms: GetPublicAdPlatforms;
}

/** Framework-agnostic interface boundary for ad platform connections (no HTTP server). */
export class ConnectionsController {
  private readonly deps: ConnectionsControllerDeps;

  constructor(deps: ConnectionsControllerDeps) {
    this.deps = deps;
  }

  async list(input: { readonly tenantId: string }): Promise<ControllerResponse> {
    return this.respond(() => this.deps.listConnections.execute(input));
  }

  async save(input: SaveConnectionInput): Promise<ControllerResponse> {
    return this.respond(() => this.deps.saveConnection.execute(input));
  }

  async publicView(input: { readonly tenantId: string }): Promise<ControllerResponse> {
    return this.respond(() => this.deps.getPublicAdPlatforms.execute(input));
  }

  /** A use case never rejects by contract; if one does, answer a generic error with no cause. */
  private async respond<T>(
    run: () => Promise<Result<T, DomainError>>,
  ): Promise<ControllerResponse> {
    try {
      return present(await run(), 200);
    } catch {
      return present(err(new UnexpectedError()), 200);
    }
  }
}
