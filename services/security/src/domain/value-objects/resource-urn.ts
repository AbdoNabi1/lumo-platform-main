import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

export interface ResourceUrnProps {
  readonly context: string;
  readonly type: string;
  readonly id: string;
}

const SEGMENT = /^(?:\*|[A-Za-z0-9][A-Za-z0-9_.-]*)$/;

/**
 * The **resource model** — every platform resource addressable by policy as
 * `morbeh:<context>:<type>:<id>` (e.g. `morbeh:orders:order:ord_123`, `morbeh:catalog:product:*`). Any
 * segment may be `*` (wildcard). Policies target resources by URN pattern; a concrete resource
 * `matches` a pattern when each pattern segment is `*` or equal (ADR-0023, sprint Part 2/3).
 */
export class ResourceUrn extends ValueObject<ResourceUrnProps> {
  private constructor(props: ResourceUrnProps) {
    super(props);
  }

  static create(context: string, type: string, id: string): Result<ResourceUrn, ValidationError> {
    for (const [field, value] of [
      ["context", context],
      ["type", type],
      ["id", id],
    ] as const) {
      if (!SEGMENT.test(value)) {
        return err(
          new ValidationError(`resource urn ${field} is invalid`, [
            { field, message: "must be '*' or [A-Za-z0-9][A-Za-z0-9_.-]*" },
          ]),
        );
      }
    }
    return ok(new ResourceUrn({ context, type, id }));
  }

  static parse(urn: string): Result<ResourceUrn, ValidationError> {
    const parts = urn.split(":");
    if (parts.length !== 4 || parts[0] !== "morbeh") {
      return err(
        new ValidationError("resource urn is malformed", [
          { field: "urn", message: "expected morbeh:<context>:<type>:<id>" },
        ]),
      );
    }
    return ResourceUrn.create(parts[1] ?? "", parts[2] ?? "", parts[3] ?? "");
  }

  get context(): string {
    return this.props.context;
  }
  get type(): string {
    return this.props.type;
  }
  get id(): string {
    return this.props.id;
  }

  override toString(): string {
    return `morbeh:${this.props.context}:${this.props.type}:${this.props.id}`;
  }

  /** True when THIS concrete resource is matched by `pattern` (pattern segments may be `*`). */
  matches(pattern: ResourceUrn): boolean {
    const seg = (p: string, v: string): boolean => p === "*" || p === v;
    return (
      seg(pattern.props.context, this.props.context) &&
      seg(pattern.props.type, this.props.type) &&
      seg(pattern.props.id, this.props.id)
    );
  }
}
