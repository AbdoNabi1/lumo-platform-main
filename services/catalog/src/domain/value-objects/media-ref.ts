import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface MediaRefProps {
  readonly assetId: string;
}

/**
 * A reference to a Media-context asset by **bare id** — no cross-context import or FK (the asset
 * is owned by the Media context). This is how Catalog points at media while staying independent.
 */
export class MediaRef extends ValueObject<MediaRefProps> {
  static create(assetId: string): Result<MediaRef, ValidationError> {
    const guarded = Guard.againstEmpty(assetId, "assetId");
    return guarded.ok ? ok(new MediaRef({ assetId })) : err(guarded.error);
  }

  get assetId(): string {
    return this.props.assetId;
  }
}
