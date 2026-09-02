import type {
  CreateReturnRequest,
  CreateReturnRequestInput,
} from "../application/create-return-request.use-case";
import type {
  GetReturnByOrder,
  GetReturnByOrderInput,
} from "../application/get-return-by-order.use-case";
import type {
  AcceptItems,
  AcceptItemsInput,
  AdvanceReturn,
  AdvanceReturnInput,
  DecideApproval,
  DecideApprovalInput,
  DecideResolution,
  DecideResolutionInput,
  GenerateRma,
  GenerateRmaInput,
  InspectItems,
  InspectItemsInput,
  ReceivePackage,
  ReceivePackageInput,
} from "../application/return-lifecycle.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface ReturnsControllerDeps {
  readonly createReturnRequest: CreateReturnRequest;
  readonly decideApproval: DecideApproval;
  readonly generateRma: GenerateRma;
  readonly receivePackage: ReceivePackage;
  readonly inspectItems: InspectItems;
  readonly acceptItems: AcceptItems;
  readonly advanceReturn: AdvanceReturn;
  readonly decideResolution: DecideResolution;
  readonly getReturnByOrder: GetReturnByOrder;
}

/** Framework-agnostic interface boundary for returns use-cases (no HTTP server). */
export class ReturnsController {
  private readonly deps: ReturnsControllerDeps;

  constructor(deps: ReturnsControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateReturnRequestInput): Promise<ControllerResponse> {
    return present(await this.deps.createReturnRequest.execute(input), 201);
  }

  async decision(input: DecideApprovalInput): Promise<ControllerResponse> {
    return present(await this.deps.decideApproval.execute(input), 200);
  }

  async rma(input: GenerateRmaInput): Promise<ControllerResponse> {
    return present(await this.deps.generateRma.execute(input), 200);
  }

  async receive(input: ReceivePackageInput): Promise<ControllerResponse> {
    return present(await this.deps.receivePackage.execute(input), 200);
  }

  async inspection(input: InspectItemsInput): Promise<ControllerResponse> {
    return present(await this.deps.inspectItems.execute(input), 200);
  }

  async accept(input: AcceptItemsInput): Promise<ControllerResponse> {
    return present(await this.deps.acceptItems.execute(input), 200);
  }

  async advance(input: AdvanceReturnInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceReturn.execute(input), 200);
  }

  async resolution(input: DecideResolutionInput): Promise<ControllerResponse> {
    return present(await this.deps.decideResolution.execute(input), 200);
  }

  async getByOrder(input: GetReturnByOrderInput): Promise<ControllerResponse> {
    return present(await this.deps.getReturnByOrder.execute(input), 200);
  }
}
