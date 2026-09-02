import { Guard, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

const ROUTE_PATTERN =
  /^\/(([a-z0-9_-]+|:[a-zA-Z][a-zA-Z0-9_]*)(\/([a-z0-9_-]+|:[a-zA-Z][a-zA-Z0-9_]*))*)?$/;

interface RoutePathProps {
  readonly value: string;
}

/** A page's route, supporting dynamic `:param` segments (e.g. `/products/:slug`). */
export class RoutePath extends ValueObject<RoutePathProps> {
  static create(value: string): Result<RoutePath, ValidationError> {
    const guarded = Guard.againstEmpty(value, "routePath");
    if (!guarded.ok) return err(guarded.error);
    if (!ROUTE_PATTERN.test(value)) {
      return err(
        new ValidationError("Invalid route path", [
          {
            field: "routePath",
            message: "must be a lowercase slash-separated path, e.g. /products/:slug",
          },
        ]),
      );
    }
    return ok(new RoutePath({ value }));
  }

  get value(): string {
    return this.props.value;
  }

  get isDynamic(): boolean {
    return this.props.value.includes(":");
  }
}
