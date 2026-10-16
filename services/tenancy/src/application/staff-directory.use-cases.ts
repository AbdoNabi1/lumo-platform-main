import type { UseCase } from "@platform/application";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConflictError, type DomainError, NotFoundError } from "@platform/utils";
import type { StaffDirectoryRepository } from "../domain/repositories";
import {
  normaliseEmail,
  StaffDirectoryEntry,
  type StaffDirectoryEntryInput,
  type StaffDirectoryEntryView,
} from "../domain/staff-directory";

export interface StaffDirectoryDeps {
  readonly staffDirectory: StaffDirectoryRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

export function toStaffDirectoryEntryView(entry: StaffDirectoryEntry): StaffDirectoryEntryView {
  return {
    email: entry.email,
    shopId: entry.shopId,
    ownerExternalId: entry.ownerExternalId,
    status: entry.status,
  };
}

/** Records that `email` signs in to `shopId`, as `pending` until sign-up completes. One store per email. */
export class RecordPendingOwner implements UseCase<
  StaffDirectoryEntryInput,
  StaffDirectoryEntryView,
  DomainError
> {
  private readonly deps: StaffDirectoryDeps;

  constructor(deps: StaffDirectoryDeps) {
    this.deps = deps;
  }

  async execute(
    input: StaffDirectoryEntryInput,
  ): Promise<Result<StaffDirectoryEntryView, DomainError>> {
    const entry = StaffDirectoryEntry.create(input);
    if (!entry.ok) return err(entry.error);
    return this.deps.unitOfWork.run<Result<StaffDirectoryEntryView, DomainError>>(async (tx) => {
      const existing = await this.deps.staffDirectory.findByEmail(entry.value.email, tx);
      if (existing !== null) return err(new ConflictError("Email already has a store"));
      await this.deps.staffDirectory.save(entry.value, tx);
      return ok(toStaffDirectoryEntryView(entry.value));
    });
  }
}

/** Marks a pending entry active. Idempotent: an active entry is returned unchanged. */
export class ActivateDirectoryEntry implements UseCase<
  { readonly email: string },
  StaffDirectoryEntryView,
  DomainError
> {
  private readonly deps: StaffDirectoryDeps;

  constructor(deps: StaffDirectoryDeps) {
    this.deps = deps;
  }

  async execute(input: {
    readonly email: string;
  }): Promise<Result<StaffDirectoryEntryView, DomainError>> {
    return this.deps.unitOfWork.run<Result<StaffDirectoryEntryView, DomainError>>(async (tx) => {
      const entry = await this.deps.staffDirectory.findByEmail(normaliseEmail(input.email), tx);
      if (entry === null) return err(new NotFoundError("No store is registered for this email"));
      if (entry.status === "active") return ok(toStaffDirectoryEntryView(entry));
      const activated = entry.activate();
      await this.deps.staffDirectory.save(activated, tx);
      return ok(toStaffDirectoryEntryView(activated));
    });
  }
}

export class FindStaffDirectoryEntry {
  private readonly deps: Pick<StaffDirectoryDeps, "staffDirectory">;

  constructor(deps: Pick<StaffDirectoryDeps, "staffDirectory">) {
    this.deps = deps;
  }

  async execute(email: string): Promise<StaffDirectoryEntryView | null> {
    const entry = await this.deps.staffDirectory.findByEmail(normaliseEmail(email));
    return entry === null ? null : toStaffDirectoryEntryView(entry);
  }
}
