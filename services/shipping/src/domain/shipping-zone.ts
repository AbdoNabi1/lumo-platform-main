import {
  AggregateRoot,
  Entity,
  NotFoundError,
  ValidationError,
  type FieldIssue,
  type UniqueEntityId,
} from "@platform/domain";

export const MAX_NAME_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 200;
/** `shipping_rates.price_minor` is a 32-bit INTEGER. */
export const MAX_PRICE_MINOR = 2_147_483_647;
export const GENERAL_PROFILE = "general";
/** The "rest of world" country code (Shopify: "Rest of world"). */
export const REST_OF_WORLD = "*";

/**
 * When a rate applies (Shopify "Add conditions"). Order price bounds are minor units of the store
 * currency, weight bounds are grams. The minimum is inclusive and the maximum exclusive.
 */
export type RateCondition =
  | { readonly type: "none" }
  | { readonly type: "orderPrice"; readonly minMinor?: number; readonly maxMinor?: number }
  | { readonly type: "weight"; readonly minGrams?: number; readonly maxGrams?: number };

/** One country of a zone. `provinces: null` is the whole country; a list is only those provinces. */
export interface ZoneCountry {
  readonly code: string;
  readonly provinces: readonly string[] | null;
}

export interface RateInput {
  readonly name: string;
  readonly priceMinor: number;
  readonly condition?: RateCondition;
  readonly description?: string | null;
}

export interface ZoneInput {
  readonly name: string;
  readonly countries: readonly ZoneCountry[];
  readonly profile?: string;
}

function fail(issues: readonly FieldIssue[]): never {
  throw new ValidationError("Invalid shipping zone", issues);
}

function cleanName(value: string, issues: FieldIssue[]): string {
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    issues.push({ field: "name", message: `must be 1-${MAX_NAME_LENGTH} characters` });
  }
  return name;
}

function isBound(value: number | undefined): value is number {
  return value !== undefined;
}

function boundIsValid(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}

function cleanCondition(condition: RateCondition | undefined, issues: FieldIssue[]): RateCondition {
  if (condition === undefined || condition.type === "none") return { type: "none" };
  const [min, max] =
    condition.type === "orderPrice"
      ? [condition.minMinor, condition.maxMinor]
      : [condition.minGrams, condition.maxGrams];
  if (!boundIsValid(min) || !boundIsValid(max)) {
    issues.push({ field: "condition", message: "bounds must be whole numbers from 0" });
    return { type: "none" };
  }
  if (isBound(min) && isBound(max) && min >= max) {
    issues.push({ field: "condition", message: "the minimum must be below the maximum" });
    return { type: "none" };
  }
  // A condition with neither bound restricts nothing.
  if (min === undefined && max === undefined) return { type: "none" };
  if (condition.type === "orderPrice") {
    return {
      type: "orderPrice",
      ...(min === undefined ? {} : { minMinor: min }),
      ...(max === undefined ? {} : { maxMinor: max }),
    };
  }
  return {
    type: "weight",
    ...(min === undefined ? {} : { minGrams: min }),
    ...(max === undefined ? {} : { maxGrams: max }),
  };
}

function cleanCountries(
  countries: readonly ZoneCountry[],
  issues: FieldIssue[],
): readonly ZoneCountry[] {
  const problem = (message: string): void => {
    issues.push({ field: "countries", message });
  };
  if (countries.length === 0) problem("a zone needs at least one country");
  const seen = new Set<string>();
  for (const country of countries) {
    if (seen.has(country.code)) problem(`${country.code} is listed twice`);
    seen.add(country.code);
    if (country.provinces !== null) {
      if (country.provinces.length === 0) {
        problem(`${country.code}: list at least one province, or the whole country`);
      }
      if (new Set(country.provinces).size !== country.provinces.length) {
        problem(`${country.code}: a province is listed twice`);
      }
    }
  }
  if (seen.has(REST_OF_WORLD)) {
    const whole = countries.find((c) => c.code === REST_OF_WORLD);
    if (countries.length > 1 || whole?.provinces !== null) {
      problem("rest of world stands alone and covers everything");
    }
  }
  return countries.map((c) => ({
    code: c.code,
    provinces: c.provinces === null ? null : [...c.provinces],
  }));
}

interface RateProps {
  name: string;
  priceMinor: number;
  condition: RateCondition;
  description: string | null;
  position: number;
}

/** One price a shopper can pick at checkout (Shopify's shipping rate). Owned by its {@link ShippingZone}. */
export class ShippingRate extends Entity<RateProps> {
  static create(id: UniqueEntityId, input: RateInput, position: number): ShippingRate {
    return new ShippingRate(ShippingRate.validate(input, position), id);
  }

  static reconstitute(id: UniqueEntityId, props: RateProps): ShippingRate {
    return new ShippingRate({ ...props }, id);
  }

  private static validate(input: RateInput, position: number): RateProps {
    const issues: FieldIssue[] = [];
    const name = cleanName(input.name, issues);
    if (
      !Number.isSafeInteger(input.priceMinor) ||
      input.priceMinor < 0 ||
      input.priceMinor > MAX_PRICE_MINOR
    ) {
      issues.push({ field: "priceMinor", message: "must be a whole number of minor units from 0" });
    }
    const description = input.description?.trim() ?? "";
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      issues.push({
        field: "description",
        message: `must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
      });
    }
    const condition = cleanCondition(input.condition, issues);
    if (issues.length > 0) fail(issues);
    return {
      name,
      priceMinor: input.priceMinor,
      condition,
      description: description.length === 0 ? null : description,
      position,
    };
  }

  replace(input: RateInput): void {
    const next = ShippingRate.validate(input, this.props.position);
    this.props.name = next.name;
    this.props.priceMinor = next.priceMinor;
    this.props.condition = next.condition;
    this.props.description = next.description;
  }

  get name(): string {
    return this.props.name;
  }

  get priceMinor(): number {
    return this.props.priceMinor;
  }

  get condition(): RateCondition {
    return this.props.condition;
  }

  get description(): string | null {
    return this.props.description;
  }

  get position(): number {
    return this.props.position;
  }
}

interface ZoneProps {
  name: string;
  profile: string;
  countries: readonly ZoneCountry[];
  rates: ShippingRate[];
  position: number;
}

/**
 * A shipping zone (Shopify: Shipping and delivery → General shipping rates): a named set of
 * countries — or provinces of a country — and the rates offered to addresses inside it. It owns its
 * rates. Whether a country is in two zones of one profile, and whether codes are real, are checked
 * where the other zones and the region data are visible (the use cases), not here.
 */
export class ShippingZone extends AggregateRoot<ZoneProps> {
  static create(id: UniqueEntityId, input: ZoneInput, position = 0): ShippingZone {
    const issues: FieldIssue[] = [];
    const name = cleanName(input.name, issues);
    const countries = cleanCountries(input.countries, issues);
    if (issues.length > 0) fail(issues);
    return new ShippingZone(
      { name, profile: input.profile ?? GENERAL_PROFILE, countries, rates: [], position },
      id,
    );
  }

  static reconstitute(
    id: UniqueEntityId,
    props: {
      readonly name: string;
      readonly profile: string;
      readonly countries: readonly ZoneCountry[];
      readonly rates: readonly ShippingRate[];
      readonly position: number;
    },
    version = 0,
  ): ShippingZone {
    return new ShippingZone({ ...props, rates: [...props.rates] }, id, version);
  }

  rename(name: string): void {
    const issues: FieldIssue[] = [];
    const cleaned = cleanName(name, issues);
    if (issues.length > 0) fail(issues);
    this.props.name = cleaned;
  }

  setCountries(countries: readonly ZoneCountry[]): void {
    const issues: FieldIssue[] = [];
    const cleaned = cleanCountries(countries, issues);
    if (issues.length > 0) fail(issues);
    this.props.countries = cleaned;
  }

  addRate(id: UniqueEntityId, input: RateInput): void {
    const next = this.props.rates.reduce((max, rate) => Math.max(max, rate.position + 1), 0);
    this.props.rates.push(ShippingRate.create(id, input, next));
  }

  updateRate(rateId: string, input: RateInput): void {
    this.rateOrThrow(rateId).replace(input);
  }

  removeRate(rateId: string): void {
    const rate = this.rateOrThrow(rateId);
    this.props.rates.splice(this.props.rates.indexOf(rate), 1);
  }

  private rateOrThrow(rateId: string): ShippingRate {
    const rate = this.props.rates.find((candidate) => candidate.id.toString() === rateId);
    if (rate === undefined) throw new NotFoundError("Shipping rate not found");
    return rate;
  }

  get name(): string {
    return this.props.name;
  }

  get profile(): string {
    return this.props.profile;
  }

  get countries(): readonly ZoneCountry[] {
    return this.props.countries;
  }

  get position(): number {
    return this.props.position;
  }

  /** In display order. */
  get rates(): readonly ShippingRate[] {
    return [...this.props.rates].sort((a, b) => a.position - b.position);
  }
}
