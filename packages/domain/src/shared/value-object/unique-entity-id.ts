import { Guard } from "../guards/guard";
import { ValueObject } from "./value-object";

interface UniqueEntityIdProps {
  readonly value: string;
}

/**
 * Aggregate/entity identity, modelled as a value object (equality by value).
 *
 * The domain NEVER generates identifiers — it is fully deterministic and
 * infrastructure-independent. New ids are produced by the `IdGenerator` port (interface in
 * `@platform/contracts`, implemented by infrastructure) and passed in; existing ids are
 * rehydrated from persistence via {@link UniqueEntityId.from}.
 */
export class UniqueEntityId extends ValueObject<UniqueEntityIdProps> {
  private constructor(props: UniqueEntityIdProps) {
    super(props);
  }

  /**
   * Rehydrates an identifier from an existing string value (persistence or a generated id).
   * Rejects empty or whitespace-only values — an invariant violation — by throwing the kernel
   * `ValidationError` produced by {@link Guard.againstEmpty}.
   */
  static from(value: string): UniqueEntityId {
    const guarded = Guard.againstEmpty(value, "UniqueEntityId.value");
    if (!guarded.ok) {
      throw guarded.error;
    }
    return new UniqueEntityId({ value });
  }

  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
