export interface ShippableOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly open: boolean;
  readonly paymentStatus: "pending" | "paid" | "refunded" | "voided";
  readonly totalMinor: number;
  readonly currency: string;
  readonly paymentRef?: string;
  readonly items: readonly {
    readonly productId: string;
    readonly name: string;
    readonly variantTitle: string | null;
    readonly quantity: number;
    readonly imageUrl: string | null;
  }[];
  readonly shippingAddress: {
    readonly recipientName?: string;
    readonly phone?: string;
    readonly line1: string;
    readonly line2?: string;
    readonly city: string;
    readonly province?: string;
    readonly country: string;
  };
}
export interface CodIntentFacts {
  readonly provider: string;
  readonly status: string;
  readonly amountMinor: number;
  readonly currency: string;
}
export interface CarrierOrderReader {
  read(tenantId: string, orderId: string): Promise<ShippableOrder | null>;
  codIntent(tenantId: string, paymentRef: string): Promise<CodIntentFacts | null>;
}
export type ShipCode = string;
export interface ShipResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly shipmentId: string;
  readonly trackingNumber: string;
  readonly carrierKey: string;
}
export type ShipOutcome =
  | { readonly ok: true; readonly value: ShipResult }
  | {
      readonly ok: false;
      readonly code: ShipCode;
      readonly httpStatus: number;
      readonly reason?: string;
      readonly orderNumber?: string;
    };
