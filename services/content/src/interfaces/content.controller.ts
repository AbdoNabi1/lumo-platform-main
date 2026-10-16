import type {
  AdvanceContentBlock,
  AdvanceContentBlockInput,
  CreateContentBlock,
  CreateContentBlockInput,
  ListContentBlocks,
  ListContentBlocksInput,
  UpdateContentBody,
  UpdateContentBodyInput,
} from "../application/content.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface ContentControllerDeps {
  readonly createContentBlock: CreateContentBlock;
  readonly advanceContentBlock: AdvanceContentBlock;
  readonly updateContentBody: UpdateContentBody;
  readonly listContentBlocks: ListContentBlocks;
}

/** Framework-agnostic interface boundary for content use-cases (no HTTP server). */
export class ContentController {
  private readonly deps: ContentControllerDeps;

  constructor(deps: ContentControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateContentBlockInput): Promise<ControllerResponse> {
    return present(await this.deps.createContentBlock.execute(input), 201);
  }

  async advance(input: AdvanceContentBlockInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceContentBlock.execute(input), 200);
  }

  async updateBody(input: UpdateContentBodyInput): Promise<ControllerResponse> {
    return present(await this.deps.updateContentBody.execute(input), 200);
  }

  async list(input: ListContentBlocksInput): Promise<ControllerResponse> {
    return present(await this.deps.listContentBlocks.execute(input), 200);
  }
}
