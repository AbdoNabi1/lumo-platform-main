import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

interface HostnameProps {
  readonly value: string;
}

/**
 * A DNS hostname a shop is served on (Plan 1A). Normalised to lowercase with no trailing dot.
 * Unicode (IDN) hostnames must arrive IDNA-encoded (`xn--...`); browsers and `new URL()` already
 * send them that way in the `Host` header.
 */
export class Hostname extends ValueObject<HostnameProps> {
  static create(raw: string): Result<Hostname, ValidationError> {
    const value = raw.trim().toLowerCase().replace(/\.$/, "");
    const invalid = (message: string) =>
      err(new ValidationError("Invalid hostname", [{ field: "hostname", message }]));
    if (value.length === 0 || value.length > 253) return invalid("must be 1..253 characters");
    if (/[:/]/.test(value)) return invalid("must not contain a scheme, port or path");
    const labels = value.split(".");
    if (labels.length < 2) return invalid("must have at least two labels");
    if (!labels.every((label) => LABEL.test(label))) {
      return invalid(
        "each label must be 1..63 characters of a-z, 0-9 or '-', not starting or ending with '-'",
      );
    }
    return ok(new Hostname({ value }));
  }

  get value(): string {
    return this.props.value;
  }
}
