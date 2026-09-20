import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { Asset } from "../domain/asset";
import type { AssetRepository } from "../domain/asset-repository";
import { ContentType } from "../domain/value-objects/content-type";
import { StorageKey } from "../domain/value-objects/storage-key";
import { checkRegistrableKey, type StorageKeyPolicy } from "./storage-key-ownership";

export interface RegisterAssetInput {
  readonly storageKey: string;
  readonly contentType: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface RegisterAssetOutput {
  readonly id: string;
}

export interface RegisterAssetDeps {
  readonly assets: AssetRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly keyPolicy: StorageKeyPolicy;
}

/** Registers an asset's metadata and emits `media.asset_ready`. */
export class RegisterAsset implements UseCase<
  RegisterAssetInput,
  RegisterAssetOutput,
  DomainError
> {
  private readonly deps: RegisterAssetDeps;

  constructor(deps: RegisterAssetDeps) {
    this.deps = deps;
  }

  async execute(input: RegisterAssetInput): Promise<Result<RegisterAssetOutput, DomainError>> {
    const storageKey = StorageKey.create(input.storageKey);
    if (!storageKey.ok) return err(storageKey.error);
    // Same ownership rule as the Media Library door (G-68 / F-22): this path takes a client-supplied
    // key too, and today nothing checks it exists either.
    const notOwned = checkRegistrableKey(
      this.deps.keyPolicy,
      input.tenantId,
      storageKey.value.value,
    );
    if (notOwned !== null) return err(notOwned);
    const contentType = ContentType.create(input.contentType);
    if (!contentType.ok) return err(contentType.error);

    return this.deps.unitOfWork.run<Result<RegisterAssetOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const asset = Asset.register(
        id,
        storageKey.value,
        contentType.value,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.assets.save(asset, input.tenantId, tx);
      return ok({ id: id.toString() });
    });
  }
}
