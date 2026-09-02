import { ValueObject } from "@platform/domain";

interface ReturnApprovalProps {
  readonly approved: boolean;
  readonly note?: string;
  readonly decidedAt: Date;
}

/** The merchant's approve/reject decision on a return request — a decision, never an inference. */
export class ReturnApproval extends ValueObject<ReturnApprovalProps> {
  static approve(decidedAt: Date, note?: string): ReturnApproval {
    return new ReturnApproval({ approved: true, note, decidedAt });
  }

  static reject(decidedAt: Date, note?: string): ReturnApproval {
    return new ReturnApproval({ approved: false, note, decidedAt });
  }

  get approved(): boolean {
    return this.props.approved;
  }

  get note(): string | undefined {
    return this.props.note;
  }

  get decidedAt(): Date {
    return this.props.decidedAt;
  }
}
