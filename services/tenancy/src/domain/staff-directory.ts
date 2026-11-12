import { err, ok, type Result } from "@platform/types";
import { ValidationError, type FieldIssue } from "@platform/utils";

export type StaffDirectoryStatus = "pending" | "active";

/** The wire shape of a directory entry — never the entity itself. */
export interface StaffDirectoryEntryView {
  readonly email: string;
  readonly shopId: string;
  readonly ownerExternalId: string;
  readonly status: StaffDirectoryStatus;
}

/** Emails are matched case-insensitively and ignoring surrounding whitespace. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface StaffDirectoryEntryProps {
  readonly email: string;
  readonly shopId: string;
  readonly ownerExternalId: string;
  readonly status: StaffDirectoryStatus;
}

export interface StaffDirectoryEntryInput {
  readonly email: string;
  readonly shopId: string;
  readonly ownerExternalId: string;
}

/**
 * Which store a staff email signs in to (Project 1). `shopId` is the merchant tenant's id; the row
 * lives in the platform tenant's scope like `ShopDomain`. One store per email. Immutable: every
 * change returns a copy. Raises no domain events — it is operator data, not a business fact.
 */
export class StaffDirectoryEntry {
  private readonly props: StaffDirectoryEntryProps;

  private constructor(props: StaffDirectoryEntryProps) {
    this.props = props;
  }

  static create(input: StaffDirectoryEntryInput): Result<StaffDirectoryEntry, ValidationError> {
    const email = normaliseEmail(input.email);
    const shopId = input.shopId.trim();
    const ownerExternalId = input.ownerExternalId.trim();
    const issues: FieldIssue[] = [];
    if (!email.includes("@")) issues.push({ field: "email", message: "must be an email address" });
    if (shopId === "") issues.push({ field: "shopId", message: "is required" });
    if (ownerExternalId === "") issues.push({ field: "ownerExternalId", message: "is required" });
    if (issues.length > 0) return err(new ValidationError("Invalid staff directory entry", issues));
    return ok(new StaffDirectoryEntry({ email, shopId, ownerExternalId, status: "pending" }));
  }

  static restore(props: StaffDirectoryEntryProps): StaffDirectoryEntry {
    return new StaffDirectoryEntry({ ...props });
  }

  activate(): StaffDirectoryEntry {
    return new StaffDirectoryEntry({ ...this.props, status: "active" });
  }

  get email(): string {
    return this.props.email;
  }

  get shopId(): string {
    return this.props.shopId;
  }

  get ownerExternalId(): string {
    return this.props.ownerExternalId;
  }

  get status(): StaffDirectoryStatus {
    return this.props.status;
  }
}
