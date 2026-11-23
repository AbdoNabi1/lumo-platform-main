/**
 * The `Lead` aggregate: one saved submission of a lead form. Append-mostly — only `status` (and the
 * Plan D tracking outcome) change after insert. Pure: imports nothing outside the domain layer.
 */

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "converted",
  "rejected",
  "spam",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_TRACKING_STATUSES = [
  "pending",
  "suppressed",
  "skipped_spam",
  "sent",
  "failed",
] as const;
export type LeadTrackingStatus = (typeof LEAD_TRACKING_STATUSES)[number];

export interface LeadAttribution {
  readonly pageUrl: string | null;
  readonly referrer: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly cookies: {
    readonly fbp?: string;
    readonly fbc?: string;
    readonly ttp?: string;
    readonly scid?: string;
    readonly ga?: string;
  };
}

export interface LeadProps {
  readonly id: string;
  readonly formId: string;
  readonly name: string;
  readonly phone: string;
  readonly phoneE164: string;
  readonly email: string | null;
  readonly message: string | null;
  readonly status: LeadStatus;
  readonly trackingStatus: LeadTrackingStatus;
  readonly eventId: string;
  readonly sessionId: string;
  /** Client-minted idempotency key; unique per tenant. */
  readonly submissionKey: string;
  readonly spamReason: "honeypot" | "too_fast" | null;
  readonly attribution: LeadAttribution;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Lead {
  readonly props: LeadProps;

  private constructor(props: LeadProps) {
    this.props = props;
  }

  /** Rebuilds a lead exactly as stored (also used to build a brand-new one: the use case owns the rules). */
  static restore(props: LeadProps): Lead {
    return new Lead(props);
  }

  /** Same status → this instance; otherwise a copy with the new status, `version + 1`, `updatedAt = at`. */
  withStatus(status: LeadStatus, at: Date): Lead {
    if (status === this.props.status) return this;
    return new Lead({ ...this.props, status, version: this.props.version + 1, updatedAt: at });
  }
}
