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

/** One captured advertising click id, with the instant it was captured (its platform window is judged from it). */
export interface LeadClickId {
  readonly name: string;
  readonly value: string;
  /** ISO-8601 UTC instant. */
  readonly capturedAt: string;
}

export interface LeadUtm {
  readonly source?: string;
  readonly medium?: string;
  readonly campaign?: string;
  readonly content?: string;
  readonly term?: string;
}

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
  /**
   * Tracking P2-D8: the visitor's master cookie id, their latest click per platform and the page's UTM labels, so the
   * lead event can be joined to the visitor profile. All optional: rows written before this field existed (and
   * submissions from an older storefront) have none and still read.
   */
  readonly visitorId?: string;
  readonly clickIds?: readonly LeadClickId[];
  readonly utm?: LeadUtm;
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
