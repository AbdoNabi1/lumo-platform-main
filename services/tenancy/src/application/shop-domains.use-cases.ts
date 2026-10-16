import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  ConflictError,
  type DomainError,
  NotFoundError,
  ValidationError,
  isDomainError,
} from "@platform/utils";
import type { DnsVerifier } from "../domain/dns-verifier";
import type { ShopDomainRepository, TenantRepository } from "../domain/repositories";
import { ShopDomain } from "../domain/shop-domain";
import type { TenantStatus } from "../domain/tenant";
import { Hostname } from "../domain/value-objects/hostname";

export interface ShopDomainsDeps {
  readonly tenants: TenantRepository;
  readonly domains: ShopDomainRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** e.g. `morbeh.store`. Shops get `<slug>.<this>`; merchants may not claim names under it. */
  readonly platformStoreDomain?: string;
  /** Absent ⇒ custom domains cannot be verified (VerifyDomain answers BUSINESS_RULE). */
  readonly dnsVerifier?: DnsVerifier;
}

/** The wire shape of a shop domain — never the aggregate itself (see public-catalog-routes.ts). */
export interface ShopDomainView {
  readonly id: string;
  readonly shopId: string;
  readonly hostname: string;
  readonly kind: "platform" | "custom";
  readonly status: "pending" | "verified";
  readonly isPrimary: boolean;
  readonly verifiedAt: string | null;
}

export function toShopDomainView(domain: ShopDomain): ShopDomainView {
  return {
    id: domain.id.toString(),
    shopId: domain.shopRef,
    hostname: domain.hostname.value,
    kind: domain.kind,
    status: domain.status,
    isPrimary: domain.isPrimary,
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
  };
}

/** True when `hostname` is the platform zone itself or any name under it. */
export function isUnderPlatformZone(hostname: string, platformStoreDomain?: string): boolean {
  if (platformStoreDomain === undefined || platformStoreDomain === "") return false;
  const zone = platformStoreDomain.toLowerCase();
  return hostname === zone || hostname.endsWith(`.${zone}`);
}

export interface AddCustomDomainInput {
  readonly shopId: string;
  readonly hostname: string;
}

/** Adds a merchant-owned hostname as `pending`; it serves nothing until verified. */
export class AddCustomDomain implements UseCase<AddCustomDomainInput, { id: string }, DomainError> {
  private readonly deps: ShopDomainsDeps;

  constructor(deps: ShopDomainsDeps) {
    this.deps = deps;
  }

  async execute(input: AddCustomDomainInput): Promise<Result<{ id: string }, DomainError>> {
    const hostname = Hostname.create(input.hostname);
    if (!hostname.ok) return err(hostname.error);
    if (isUnderPlatformZone(hostname.value.value, this.deps.platformStoreDomain)) {
      return err(
        new ValidationError("Invalid hostname", [
          { field: "hostname", message: "names under the platform's own domain are reserved" },
        ]),
      );
    }
    return this.deps.unitOfWork.run<Result<{ id: string }, DomainError>>(async (tx) => {
      const shop = await this.deps.tenants.findById(input.shopId, tx);
      if (shop === null) return err(new NotFoundError("Shop not found"));
      const taken = await this.deps.domains.findByHostname(hostname.value.value, tx);
      if (taken !== null) {
        return err(new ConflictError(`Hostname "${hostname.value.value}" is already in use`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      await this.deps.domains.save(ShopDomain.custom(id, input.shopId, hostname.value), tx);
      return ok({ id: id.toString() });
    });
  }
}

export interface DomainIdInput {
  readonly domainId: string;
}

/** Marks a custom domain verified once its DNS points at the platform. Idempotent. */
export class VerifyDomain implements UseCase<DomainIdInput, ShopDomainView, DomainError> {
  private readonly deps: ShopDomainsDeps;

  constructor(deps: ShopDomainsDeps) {
    this.deps = deps;
  }

  async execute(input: DomainIdInput): Promise<Result<ShopDomainView, DomainError>> {
    const verifier = this.deps.dnsVerifier;
    if (verifier === undefined) {
      return err(new BusinessRuleError("Domain verification is not configured on this platform"));
    }
    return this.deps.unitOfWork.run<Result<ShopDomainView, DomainError>>(async (tx) => {
      const domain = await this.deps.domains.findById(input.domainId, tx);
      if (domain === null) return err(new NotFoundError("Domain not found"));
      if (domain.status === "verified") return ok(toShopDomainView(domain));
      if (!(await verifier.pointsToPlatform(domain.hostname.value))) {
        return err(
          new BusinessRuleError(
            `"${domain.hostname.value}" does not point at the platform yet; check its DNS record`,
          ),
        );
      }
      domain.verify(this.deps.clock.now());
      await this.deps.domains.save(domain, tx);
      return ok(toShopDomainView(domain));
    });
  }
}

/** Makes a verified domain the shop's primary; the previous primary is demoted first. */
export class SetPrimaryDomain implements UseCase<DomainIdInput, ShopDomainView, DomainError> {
  private readonly deps: ShopDomainsDeps;

  constructor(deps: ShopDomainsDeps) {
    this.deps = deps;
  }

  async execute(input: DomainIdInput): Promise<Result<ShopDomainView, DomainError>> {
    return this.deps.unitOfWork.run<Result<ShopDomainView, DomainError>>(async (tx) => {
      const domain = await this.deps.domains.findById(input.domainId, tx);
      if (domain === null) return err(new NotFoundError("Domain not found"));
      if (domain.isPrimary) return ok(toShopDomainView(domain));
      if (domain.status !== "verified") {
        return err(new BusinessRuleError("Only a verified domain can be made primary"));
      }
      // Demote BEFORE promoting: the database allows one primary per shop (partial unique index).
      for (const other of await this.deps.domains.listByShop(domain.shopRef, tx)) {
        if (other.isPrimary) {
          other.demote();
          await this.deps.domains.save(other, tx);
        }
      }
      try {
        domain.makePrimary();
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.domains.save(domain, tx);
      return ok(toShopDomainView(domain));
    });
  }
}

export interface ShopIdInput {
  readonly shopId: string;
}

export class ListShopDomains implements UseCase<
  ShopIdInput,
  { items: readonly ShopDomainView[] },
  DomainError
> {
  private readonly deps: Pick<ShopDomainsDeps, "domains">;

  constructor(deps: Pick<ShopDomainsDeps, "domains">) {
    this.deps = deps;
  }

  async execute(
    input: ShopIdInput,
  ): Promise<Result<{ items: readonly ShopDomainView[] }, DomainError>> {
    const domains = await this.deps.domains.listByShop(input.shopId);
    return ok({ items: domains.map(toShopDomainView) });
  }
}

export interface ResolveHostInput {
  readonly hostname: string;
}

export interface ResolvedHost {
  readonly shopId: string;
  readonly hostname: string;
  readonly primaryHostname: string;
  readonly shopStatus: TenantStatus;
}

/**
 * Host → shop, for the storefront edge (Plan 1A). Only VERIFIED domains resolve; a pending one is
 * NOT_FOUND exactly like an unknown one, so nobody can serve a shop on a name they have not proven.
 */
export class ResolveHost implements UseCase<ResolveHostInput, ResolvedHost, DomainError> {
  private readonly deps: Pick<ShopDomainsDeps, "domains" | "tenants">;

  constructor(deps: Pick<ShopDomainsDeps, "domains" | "tenants">) {
    this.deps = deps;
  }

  async execute(input: ResolveHostInput): Promise<Result<ResolvedHost, DomainError>> {
    const notFound = err(new NotFoundError("No shop is served on this hostname"));
    const hostname = Hostname.create(input.hostname);
    if (!hostname.ok) return notFound;
    const domain = await this.deps.domains.findByHostname(hostname.value.value);
    if (domain === null || domain.status !== "verified") return notFound;
    const shop = await this.deps.tenants.findById(domain.shopRef);
    if (shop === null) return notFound;
    const all = await this.deps.domains.listByShop(domain.shopRef);
    const primary = all.find((d) => d.isPrimary) ?? domain;
    return ok({
      shopId: domain.shopRef,
      hostname: domain.hostname.value,
      primaryHostname: primary.hostname.value,
      shopStatus: shop.status,
    });
  }
}
