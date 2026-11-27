import type {
  DeleteEmailConnection,
  GetEmailConnection,
  SaveEmailConnection,
  SetEmailConnectionEnabled,
  TestEmailConnection,
} from "../application/email-connection.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface EmailConnectionControllerDeps {
  readonly getConnection: GetEmailConnection;
  readonly saveConnection: SaveEmailConnection;
  readonly setEnabled: SetEmailConnectionEnabled;
  readonly deleteConnection: DeleteEmailConnection;
  readonly testConnection: TestEmailConnection;
}

/** Wave 2b2 (Settings > Notifications > Email account): the store's own email connection. Framework-agnostic. */
export class EmailConnectionController {
  private readonly deps: EmailConnectionControllerDeps;

  constructor(deps: EmailConnectionControllerDeps) {
    this.deps = deps;
  }

  async get(input: Parameters<GetEmailConnection["execute"]>[0]): Promise<ControllerResponse> {
    return present(await this.deps.getConnection.execute(input), 200);
  }

  async save(input: Parameters<SaveEmailConnection["execute"]>[0]): Promise<ControllerResponse> {
    return present(await this.deps.saveConnection.execute(input), 200);
  }

  async setEnabled(
    input: Parameters<SetEmailConnectionEnabled["execute"]>[0],
  ): Promise<ControllerResponse> {
    return present(await this.deps.setEnabled.execute(input), 200);
  }

  async remove(
    input: Parameters<DeleteEmailConnection["execute"]>[0],
  ): Promise<ControllerResponse> {
    return present(await this.deps.deleteConnection.execute(input), 200);
  }

  async test(input: Parameters<TestEmailConnection["execute"]>[0]): Promise<ControllerResponse> {
    return present(await this.deps.testConnection.execute(input), 200);
  }
}
