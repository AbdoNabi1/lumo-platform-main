import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface StorageKeyProps {
  readonly value: string;
}

/** Object-storage key (path) for an asset — a non-empty string. */
export class StorageKey extends ValueObject<StorageKeyProps> {
  static create(value: string): Result<StorageKey, ValidationError> {
    const guarded = Guard.againstEmpty(value, "storageKey");
    return guarded.ok ? ok(new StorageKey({ value: value.trim() })) : err(guarded.error);
  }

  get value(): string {
    return this.props.value;
  }
}
