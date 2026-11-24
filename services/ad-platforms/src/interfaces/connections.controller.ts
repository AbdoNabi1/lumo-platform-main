import type {
  GetPublicAdPlatforms,
  ListConnections,
  SaveConnection,
  SaveConnectionInput,
} from "../application/connections.use-cases";
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
    return present(await this.deps.listConnections.execute(input), 200);
  }

  async save(input: SaveConnectionInput): Promise<ControllerResponse> {
    return present(await this.deps.saveConnection.execute(input), 200);
  }

  async publicView(input: { readonly tenantId: string }): Promise<ControllerResponse> {
    return present(await this.deps.getPublicAdPlatforms.execute(input), 200);
  }
}
