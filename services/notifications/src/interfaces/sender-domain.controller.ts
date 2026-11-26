import type {
  GetSenderDomain,
  StartSenderDomain,
  VerifySenderDomain,
} from "../application/sender-domain.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface SenderDomainControllerDeps {
  readonly getDomain: GetSenderDomain;
  readonly startDomain: StartSenderDomain;
  readonly verifyDomain: VerifySenderDomain;
}

/** Wave 2b (D43): authenticating the store's own sending domain. Framework-agnostic. */
export class SenderDomainController {
  private readonly deps: SenderDomainControllerDeps;

  constructor(deps: SenderDomainControllerDeps) {
    this.deps = deps;
  }

  async get(input: Parameters<GetSenderDomain["execute"]>[0]): Promise<ControllerResponse> {
    return present(await this.deps.getDomain.execute(input), 200);
  }

  async start(input: Parameters<StartSenderDomain["execute"]>[0]): Promise<ControllerResponse> {
    return present(await this.deps.startDomain.execute(input), 200);
  }

  async verify(input: Parameters<VerifySenderDomain["execute"]>[0]): Promise<ControllerResponse> {
    return present(await this.deps.verifyDomain.execute(input), 200);
  }
}
