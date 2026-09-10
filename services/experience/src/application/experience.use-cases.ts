import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { Experience } from "../domain/experience";
import type { ExperienceRepository } from "../domain/repositories";
import { Canvas, type Section } from "../domain/value-objects/canvas";
import type { ExperienceStatusValue } from "../domain/value-objects/experience-status";

export interface ExperienceDeps {
  readonly experiences: ExperienceRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface CreateExperienceInput {
  readonly name: string;
  readonly experienceType: string;
  readonly tenantId: string;
}

export interface ExperienceStatusOutput {
  readonly experienceId: string;
  readonly status: string;
}

/** Creates an experience in `draft` status — one per `name`. */
export class CreateExperience implements UseCase<
  CreateExperienceInput,
  ExperienceStatusOutput,
  DomainError
> {
  private readonly deps: ExperienceDeps;

  constructor(deps: ExperienceDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreateExperienceInput,
  ): Promise<Result<ExperienceStatusOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<ExperienceStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.experiences.findByName(input.name, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Experience "${input.name}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const experience = Experience.create(id, input.name, input.experienceType);
      await this.deps.experiences.save(experience, tx);
      return ok({ experienceId: id.toString(), status: experience.status.value });
    });
  }
}

export interface ExperienceIdInput {
  readonly experienceId: string;
  readonly tenantId: string;
}

export interface AdvanceExperienceInput extends ExperienceIdInput {
  readonly toStatus: ExperienceStatusValue;
}

/** Generic validated transition — used for publish/archive. */
export class AdvanceExperience implements UseCase<
  AdvanceExperienceInput,
  ExperienceStatusOutput,
  DomainError
> {
  private readonly deps: ExperienceDeps;

  constructor(deps: ExperienceDeps) {
    this.deps = deps;
  }

  async execute(
    input: AdvanceExperienceInput,
  ): Promise<Result<ExperienceStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ExperienceStatusOutput, DomainError>>(async (tx) => {
      const experience = await this.deps.experiences.findById(
        input.experienceId,
        input.tenantId,
        tx,
      );
      if (experience === null) return err(new NotFoundError("Experience not found"));

      try {
        experience.transition(
          input.toStatus,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.experiences.save(experience, tx);
      return ok({ experienceId: experience.id.toString(), status: experience.status.value });
    });
  }
}

export interface UpdateCanvasInput extends ExperienceIdInput {
  readonly sections: readonly Section[];
}

/** Replaces the draft canvas tree. */
export class UpdateCanvas implements UseCase<
  UpdateCanvasInput,
  ExperienceStatusOutput,
  DomainError
> {
  private readonly deps: ExperienceDeps;

  constructor(deps: ExperienceDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateCanvasInput): Promise<Result<ExperienceStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ExperienceStatusOutput, DomainError>>(async (tx) => {
      const experience = await this.deps.experiences.findById(
        input.experienceId,
        input.tenantId,
        tx,
      );
      if (experience === null) return err(new NotFoundError("Experience not found"));

      try {
        experience.updateCanvas(Canvas.create(input.sections));
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.experiences.save(experience, tx);
      return ok({ experienceId: experience.id.toString(), status: experience.status.value });
    });
  }
}
