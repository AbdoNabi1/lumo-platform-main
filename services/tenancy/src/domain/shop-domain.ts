import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import type { Hostname } from "./value-objects/hostname";

export type ShopDomainKind = "platform" | "custom";
export type ShopDomainStatus = "pending" | "verified";

export interface ShopDomainProps {
  readonly shopRef: string;
  readonly hostname: Hostname;
  readonly kind: ShopDomainKind;
  status: ShopDomainStatus;
  isPrimary: boolean;
  verifiedAt?: Date;
}

/**
 * A hostname a shop is served on (Plan 1A) — Shopify's `Domain`. `shopRef` is the merchant
 * tenant's id; the row itself lives in the platform tenant's scope like `Tenant`. Raises no
 * domain events on purpose: changes are audited by `AdminGuard` at the route, and adding event
 * types grows the topic inventory (G-80) for no consumer.
 */
export class ShopDomain extends AggregateRoot<ShopDomainProps> {
  static platform(id: UniqueEntityId, shopRef: string, hostname: Hostname, at: Date): ShopDomain {
    return new ShopDomain(
      { shopRef, hostname, kind: "platform", status: "verified", isPrimary: true, verifiedAt: at },
      id,
    );
  }

  static custom(id: UniqueEntityId, shopRef: string, hostname: Hostname): ShopDomain {
    return new ShopDomain(
      { shopRef, hostname, kind: "custom", status: "pending", isPrimary: false },
      id,
    );
  }

  static reconstitute(id: UniqueEntityId, props: ShopDomainProps, version: number): ShopDomain {
    return new ShopDomain({ ...props }, id, version);
  }

  verify(at: Date): void {
    if (this.props.status === "verified") return;
    this.props.status = "verified";
    this.props.verifiedAt = at;
  }

  makePrimary(): void {
    if (this.props.status !== "verified") {
      throw new BusinessRuleError("Only a verified domain can be made primary");
    }
    this.props.isPrimary = true;
  }

  demote(): void {
    this.props.isPrimary = false;
  }

  get shopRef(): string {
    return this.props.shopRef;
  }

  get hostname(): Hostname {
    return this.props.hostname;
  }

  get kind(): ShopDomainKind {
    return this.props.kind;
  }

  get status(): ShopDomainStatus {
    return this.props.status;
  }

  get isPrimary(): boolean {
    return this.props.isPrimary;
  }

  get verifiedAt(): Date | undefined {
    return this.props.verifiedAt;
  }
}
