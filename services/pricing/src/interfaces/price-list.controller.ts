import type {
  ActivatePriceList,
  ActivatePriceListInput,
} from "../application/activate-price-list.use-case";
import type {
  CreatePriceList,
  CreatePriceListInput,
} from "../application/create-price-list.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface PriceListControllerDeps {
  readonly createPriceList: CreatePriceList;
  readonly activatePriceList: ActivatePriceList;
}

/** Framework-agnostic interface boundary for price-list use-cases (no HTTP server). */
export class PriceListController {
  private readonly deps: PriceListControllerDeps;

  constructor(deps: PriceListControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreatePriceListInput): Promise<ControllerResponse> {
    return present(await this.deps.createPriceList.execute(input), 201);
  }

  async activate(input: ActivatePriceListInput): Promise<ControllerResponse> {
    return present(await this.deps.activatePriceList.execute(input), 200);
  }
}
