import type { UseCase } from "@platform/application";
import type { IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, isDomainError } from "@platform/utils";
import {
  ShippingZone,
  type RateCondition,
  type ShippingRate,
  type ZoneCountry,
} from "../domain/shipping-zone";
import type { ShippingZoneRepository } from "../domain/shipping-zone-repository";
import { invalidCountries, overlapIssues, regionIssues } from "./zone-countries";

export interface ShippingZonesDeps {
  readonly zones: ShippingZoneRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
}

export interface RateView {
  readonly id: string;
  readonly name: string;
  readonly priceMinor: number;
  readonly condition: RateCondition;
  readonly description: string | null;
}

/** The wire shape of a zone — never the aggregate itself. */
export interface ZoneView {
  readonly id: string;
  readonly name: string;
  readonly profile: string;
  readonly countries: readonly {
    readonly code: string;
    readonly provinces: readonly string[] | null;
  }[];
  readonly rates: readonly RateView[];
}

function toRateView(rate: ShippingRate): RateView {
  return {
    id: rate.id.toString(),
    name: rate.name,
    priceMinor: rate.priceMinor,
    condition: rate.condition,
    description: rate.description,
  };
}

export function toZoneView(zone: ShippingZone): ZoneView {
  return {
    id: zone.id.toString(),
    name: zone.name,
    profile: zone.profile,
    countries: zone.countries.map((c) => ({
      code: c.code,
      provinces: c.provinces === null ? null : [...c.provinces],
    })),
    rates: zone.rates.map(toRateView),
  };
}

/** Runs `change`, turning the aggregate's validation / not-found errors into a `Result`. */
function attempt<T>(change: () => T): Result<T, DomainError> {
  try {
    return ok(change());
  } catch (error) {
    if (isDomainError(error)) return err(error);
    throw error;
  }
}

export interface TenantInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export class ListZones implements UseCase<
  TenantInput,
  { items: readonly ZoneView[] },
  DomainError
> {
  private readonly deps: Pick<ShippingZonesDeps, "zones">;

  constructor(deps: Pick<ShippingZonesDeps, "zones">) {
    this.deps = deps;
  }

  async execute(input: TenantInput): Promise<Result<{ items: readonly ZoneView[] }, DomainError>> {
    const zones = await this.deps.zones.list(input.tenantId);
    return ok({ items: zones.map(toZoneView) });
  }
}

export interface CreateZoneInput extends TenantInput {
  readonly name: string;
  readonly countries: readonly ZoneCountry[];
  /** Plan 3E: first rates, saved with the zone in the same unit of work (all or nothing). */
  readonly rates?: readonly RateFields[];
}

/** Region checks and the one-zone-per-country rule, against the tenant's other zones. */
async function checkCountries(
  deps: ShippingZonesDeps,
  tenantId: string,
  countries: readonly ZoneCountry[],
  tx: unknown,
  ownId?: string,
): Promise<DomainError | null> {
  const issues = regionIssues(countries);
  if (issues.length === 0) {
    const others = (await deps.zones.list(tenantId, tx)).filter(
      (zone) => zone.id.toString() !== ownId,
    );
    issues.push(...overlapIssues(countries, others));
  }
  return issues.length === 0 ? null : invalidCountries(issues);
}

export class CreateZone implements UseCase<CreateZoneInput, { id: string }, DomainError> {
  private readonly deps: ShippingZonesDeps;

  constructor(deps: ShippingZonesDeps) {
    this.deps = deps;
  }

  async execute(input: CreateZoneInput): Promise<Result<{ id: string }, DomainError>> {
    return this.deps.unitOfWork.run<Result<{ id: string }, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const position = (await this.deps.zones.list(input.tenantId, tx)).length;
      const built = attempt(() =>
        ShippingZone.create(id, { name: input.name, countries: input.countries }, position),
      );
      if (!built.ok) return err(built.error);
      const zone = built.value;
      const withRates = attempt(() => {
        for (const rate of input.rates ?? []) {
          zone.addRate(UniqueEntityId.from(this.deps.idGenerator.generate()), rateFields(rate));
        }
      });
      if (!withRates.ok) return err(withRates.error);
      const problem = await checkCountries(this.deps, input.tenantId, input.countries, tx);
      if (problem !== null) return err(problem);
      await this.deps.zones.save(zone, input.tenantId, tx);
      return ok({ id: id.toString() });
    });
  }
}

export interface ZoneIdInput extends TenantInput {
  readonly zoneId: string;
}

export interface UpdateZoneInput extends ZoneIdInput {
  readonly name: string;
  readonly countries: readonly ZoneCountry[];
}

export class UpdateZone implements UseCase<UpdateZoneInput, ZoneView, DomainError> {
  private readonly deps: ShippingZonesDeps;

  constructor(deps: ShippingZonesDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateZoneInput): Promise<Result<ZoneView, DomainError>> {
    return this.deps.unitOfWork.run<Result<ZoneView, DomainError>>(async (tx) => {
      const zone = await this.deps.zones.findById(input.zoneId, input.tenantId, tx);
      if (zone === null) return err(new NotFoundError("Shipping zone not found"));
      const changed = attempt(() => {
        zone.rename(input.name);
        zone.setCountries(input.countries);
      });
      if (!changed.ok) return err(changed.error);
      const problem = await checkCountries(
        this.deps,
        input.tenantId,
        input.countries,
        tx,
        input.zoneId,
      );
      if (problem !== null) return err(problem);
      await this.deps.zones.save(zone, input.tenantId, tx);
      return ok(toZoneView(zone));
    });
  }
}

export class DeleteZone implements UseCase<ZoneIdInput, { id: string }, DomainError> {
  private readonly deps: ShippingZonesDeps;

  constructor(deps: ShippingZonesDeps) {
    this.deps = deps;
  }

  async execute(input: ZoneIdInput): Promise<Result<{ id: string }, DomainError>> {
    return this.deps.unitOfWork.run<Result<{ id: string }, DomainError>>(async (tx) => {
      const zone = await this.deps.zones.findById(input.zoneId, input.tenantId, tx);
      if (zone === null) return err(new NotFoundError("Shipping zone not found"));
      await this.deps.zones.delete(input.zoneId, input.tenantId, tx);
      return ok({ id: input.zoneId });
    });
  }
}

export interface RateFields {
  readonly name: string;
  readonly priceMinor: number;
  readonly condition?: RateCondition;
  readonly description?: string | null;
}

export type AddRateInput = ZoneIdInput & RateFields;
export type UpdateRateInput = ZoneIdInput & RateFields & { readonly rateId: string };
export interface DeleteRateInput extends ZoneIdInput {
  readonly rateId: string;
}

function rateFields(input: RateFields): RateFields {
  return {
    name: input.name,
    priceMinor: input.priceMinor,
    ...(input.condition === undefined ? {} : { condition: input.condition }),
    ...(input.description === undefined ? {} : { description: input.description }),
  };
}

export class AddRate implements UseCase<AddRateInput, { id: string }, DomainError> {
  private readonly deps: ShippingZonesDeps;

  constructor(deps: ShippingZonesDeps) {
    this.deps = deps;
  }

  async execute(input: AddRateInput): Promise<Result<{ id: string }, DomainError>> {
    return this.deps.unitOfWork.run<Result<{ id: string }, DomainError>>(async (tx) => {
      const zone = await this.deps.zones.findById(input.zoneId, input.tenantId, tx);
      if (zone === null) return err(new NotFoundError("Shipping zone not found"));
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const added = attempt(() => zone.addRate(id, rateFields(input)));
      if (!added.ok) return err(added.error);
      await this.deps.zones.save(zone, input.tenantId, tx);
      return ok({ id: id.toString() });
    });
  }
}

export class UpdateRate implements UseCase<UpdateRateInput, RateView, DomainError> {
  private readonly deps: ShippingZonesDeps;

  constructor(deps: ShippingZonesDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateRateInput): Promise<Result<RateView, DomainError>> {
    return this.deps.unitOfWork.run<Result<RateView, DomainError>>(async (tx) => {
      const zone = await this.deps.zones.findById(input.zoneId, input.tenantId, tx);
      if (zone === null) return err(new NotFoundError("Shipping zone not found"));
      const updated = attempt(() => zone.updateRate(input.rateId, rateFields(input)));
      if (!updated.ok) return err(updated.error);
      await this.deps.zones.save(zone, input.tenantId, tx);
      const rate = zone.rates.find((candidate) => candidate.id.toString() === input.rateId);
      return rate === undefined
        ? err(new NotFoundError("Shipping rate not found"))
        : ok(toRateView(rate));
    });
  }
}

export class DeleteRate implements UseCase<DeleteRateInput, { id: string }, DomainError> {
  private readonly deps: ShippingZonesDeps;

  constructor(deps: ShippingZonesDeps) {
    this.deps = deps;
  }

  async execute(input: DeleteRateInput): Promise<Result<{ id: string }, DomainError>> {
    return this.deps.unitOfWork.run<Result<{ id: string }, DomainError>>(async (tx) => {
      const zone = await this.deps.zones.findById(input.zoneId, input.tenantId, tx);
      if (zone === null) return err(new NotFoundError("Shipping zone not found"));
      const removed = attempt(() => zone.removeRate(input.rateId));
      if (!removed.ok) return err(removed.error);
      await this.deps.zones.save(zone, input.tenantId, tx);
      return ok({ id: input.rateId });
    });
  }
}
