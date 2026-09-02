import { UniqueEntityId } from "@platform/domain";
import { Experience } from "../domain/experience";
import { ExperienceVersion } from "../domain/experience-version";
import { Canvas, type Section } from "../domain/value-objects/canvas";
import {
  ExperienceStatus,
  type ExperienceStatusValue,
} from "../domain/value-objects/experience-status";

export interface ExperienceVersionJson {
  readonly id: string;
  readonly versionNumber: number;
  readonly sections: readonly Section[];
  readonly publishedAt: string;
}

export interface ExperienceRow {
  readonly id: string;
  readonly name: string;
  readonly experienceType: string;
  readonly sections: readonly Section[];
  readonly status: string;
  readonly versions: readonly ExperienceVersionJson[];
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link Experience}. Mapping only — no I/O. */
export class ExperienceMapper {
  static toDomain(row: ExperienceRow): Experience {
    return Experience.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      row.experienceType,
      Canvas.create(row.sections),
      ExperienceStatus.from(row.status as ExperienceStatusValue),
      row.version,
      row.versions.map((v) =>
        ExperienceVersion.create(
          UniqueEntityId.from(v.id),
          v.versionNumber,
          Canvas.create(v.sections),
          new Date(v.publishedAt),
        ),
      ),
    );
  }

  static toRow(experience: Experience, tenantId: string) {
    return {
      id: experience.id.toString(),
      tenantId,
      name: experience.name,
      experienceType: experience.experienceType,
      sections: experience.canvas.sections,
      status: experience.status.value,
      versions: experience.versions.map((v) => ({
        id: v.id.toString(),
        versionNumber: v.versionNumber,
        sections: v.canvas.sections,
        publishedAt: v.publishedAt.toISOString(),
      })),
      version: 1,
    };
  }
}
