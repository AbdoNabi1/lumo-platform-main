import type {
  CreateCustomerSegment,
  CreateCustomerSegmentInput,
  DeleteCustomerSegment,
  DeleteCustomerSegmentInput,
  GetCustomerSegment,
  GetCustomerSegmentInput,
  ListCustomerSegments,
  ListCustomerSegmentsInput,
  UpdateCustomerSegment,
  UpdateCustomerSegmentInput,
} from "../application/customer-segment.use-cases";
import { present, type ControllerResponse } from "./presenter";
export interface CustomerSegmentControllerDeps {
  readonly listCustomerSegments: ListCustomerSegments;
  readonly getCustomerSegment: GetCustomerSegment;
  readonly createCustomerSegment: CreateCustomerSegment;
  readonly updateCustomerSegment: UpdateCustomerSegment;
  readonly deleteCustomerSegment: DeleteCustomerSegment;
}
export class CustomerSegmentController {
  constructor(private readonly deps: CustomerSegmentControllerDeps) {}
  async list(input: ListCustomerSegmentsInput): Promise<ControllerResponse> {
    return present(await this.deps.listCustomerSegments.execute(input), 200);
  }
  async get(input: GetCustomerSegmentInput): Promise<ControllerResponse> {
    return present(await this.deps.getCustomerSegment.execute(input), 200);
  }
  async create(input: CreateCustomerSegmentInput): Promise<ControllerResponse> {
    return present(await this.deps.createCustomerSegment.execute(input), 201);
  }
  async update(input: UpdateCustomerSegmentInput): Promise<ControllerResponse> {
    return present(await this.deps.updateCustomerSegment.execute(input), 200);
  }
  async delete(input: DeleteCustomerSegmentInput): Promise<ControllerResponse> {
    return present(await this.deps.deleteCustomerSegment.execute(input), 200);
  }
}
