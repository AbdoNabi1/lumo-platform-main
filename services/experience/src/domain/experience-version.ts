import { Entity, type UniqueEntityId } from "@platform/domain";
import type { Canvas } from "./value-objects/canvas";

interface ExperienceVersionProps {
  readonly versionNumber: number;
  readonly canvas: Canvas;
  readonly publishedAt: Date;
}

/** An append-only published-version snapshot of an experience's canvas (never rewritten). */
export class ExperienceVersion extends Entity<ExperienceVersionProps> {
  static create(
    id: UniqueEntityId,
    versionNumber: number,
    canvas: Canvas,
    publishedAt: Date,
  ): ExperienceVersion {
    return new ExperienceVersion({ versionNumber, canvas, publishedAt }, id);
  }

  get versionNumber(): number {
    return this.props.versionNumber;
  }

  get canvas(): Canvas {
    return this.props.canvas;
  }

  get publishedAt(): Date {
    return this.props.publishedAt;
  }
}
