import { ValueObject } from "@platform/domain";

interface PromotionScheduleProps {
  readonly startsAt: Date;
  readonly endsAt?: Date;
}

/** The effective-date window a promotion is live within — pure date arithmetic, no side effects. */
export class PromotionSchedule extends ValueObject<PromotionScheduleProps> {
  static create(startsAt: Date, endsAt?: Date): PromotionSchedule {
    return new PromotionSchedule({ startsAt, endsAt });
  }

  isActiveAt(now: Date): boolean {
    if (now.getTime() < this.props.startsAt.getTime()) return false;
    return this.props.endsAt === undefined || now.getTime() < this.props.endsAt.getTime();
  }

  isExpiredAt(now: Date): boolean {
    return this.props.endsAt !== undefined && now.getTime() >= this.props.endsAt.getTime();
  }

  get startsAt(): Date {
    return this.props.startsAt;
  }

  get endsAt(): Date | undefined {
    return this.props.endsAt;
  }
}

interface CustomerEligibilityProps {
  /** `undefined` = every customer is eligible (the common case). */
  readonly customerRefs?: readonly string[];
  readonly segmentRefs?: readonly string[];
}

/** Who may use a promotion — bare refs only, no customer data owned here. */
export class CustomerEligibility extends ValueObject<CustomerEligibilityProps> {
  static everyone(): CustomerEligibility {
    return new CustomerEligibility({});
  }

  static create(props: CustomerEligibilityProps): CustomerEligibility {
    return new CustomerEligibility(props);
  }

  isEligible(customerRef: string, segmentRefs: readonly string[] = []): boolean {
    if (this.props.customerRefs === undefined && this.props.segmentRefs === undefined) return true;
    if (this.props.customerRefs?.includes(customerRef)) return true;
    return this.props.segmentRefs?.some((ref) => segmentRefs.includes(ref)) ?? false;
  }

  get customerRefs(): readonly string[] | undefined {
    return this.props.customerRefs;
  }

  get segmentRefs(): readonly string[] | undefined {
    return this.props.segmentRefs;
  }
}

interface PromotionCampaignProps {
  readonly campaignRef?: string;
}

/** The marketing campaign a promotion belongs to, if any — a bare reference, no campaign data owned here. */
export class PromotionCampaign extends ValueObject<PromotionCampaignProps> {
  static none(): PromotionCampaign {
    return new PromotionCampaign({});
  }

  static create(campaignRef?: string): PromotionCampaign {
    return new PromotionCampaign({ campaignRef });
  }

  get campaignRef(): string | undefined {
    return this.props.campaignRef;
  }
}
