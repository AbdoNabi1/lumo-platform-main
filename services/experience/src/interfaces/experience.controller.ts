import type { CursorPage } from "@platform/types";
import type {
  AdvanceExperience,
  AdvanceExperienceInput,
  CreateExperience,
  CreateExperienceInput,
  ExperienceIdInput,
  UpdateCanvas,
  UpdateCanvasInput,
} from "../application/experience.use-cases";
import type { GetExperience } from "../application/get-experience.use-case";
import type { ListExperiences } from "../application/list-experiences.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface ExperienceControllerDeps {
  readonly createExperience: CreateExperience;
  readonly advanceExperience: AdvanceExperience;
  readonly updateCanvas: UpdateCanvas;
  readonly listExperiences: ListExperiences;
  readonly getExperience: GetExperience;
}

/** Framework-agnostic interface boundary for experience use-cases (no HTTP server). */
export class ExperienceController {
  private readonly deps: ExperienceControllerDeps;

  constructor(deps: ExperienceControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateExperienceInput): Promise<ControllerResponse> {
    return present(await this.deps.createExperience.execute(input), 201);
  }

  async advance(input: AdvanceExperienceInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceExperience.execute(input), 200);
  }

  async updateCanvas(input: UpdateCanvasInput): Promise<ControllerResponse> {
    return present(await this.deps.updateCanvas.execute(input), 200);
  }

  async list(input: CursorPage): Promise<ControllerResponse> {
    return present(await this.deps.listExperiences.execute(input), 200);
  }

  async get(input: ExperienceIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getExperience.execute(input), 200);
  }
}
