import { ProductRef, UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { CheckoutState, type CheckoutStateValue } from "../domain/value-objects/checkout-state";
import { CheckoutTotals } from "../domain/value-objects/checkout-totals";
import { ContactEmail } from "../domain/value-objects/contact-email";
import { PaymentSelection, ShippingSelection } from "../domain/value-objects/selections";

interface CheckoutItemJson {
  readonly productRef: string;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
  readonly currency: string;
}
interface CheckoutAddressJson {
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}
interface ShippingSelectionJson {
  readonly method: string;
  readonly rateAmountMinor: number;
  readonly currency: string;
}
interface PaymentSelectionJson {
  readonly paymentMethodRef: string;
  readonly provider: string;
}
interface CheckoutTotalsJson {
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
}

export interface CheckoutSessionRow {
  readonly id: string;
  readonly cartRef: string;
  readonly customerRef: string | null;
  readonly sessionRef: string;
  /** Nullable: every session created before the WP-1 migration has none. */
  readonly contactEmail: string | null;
  readonly currency: string;
  readonly state: string;
  readonly orderRef: string | null;
  readonly items: readonly CheckoutItemJson[];
  /** `{}` (empty object) = unset, per Sprint 4.6's own mapper convention — never `null`. */
  readonly billingAddress: CheckoutAddressJson | Record<string, never>;
  readonly shippingAddress: CheckoutAddressJson | Record<string, never>;
  readonly shippingSelection: ShippingSelectionJson | Record<string, never>;
  readonly paymentSelection: PaymentSelectionJson | Record<string, never>;
  readonly taxMinor: number | null;
  readonly discountMinor: number | null;
  readonly totals: CheckoutTotalsJson | Record<string, never>;
  readonly version: number;
}

function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(
      `Corrupt checkout session row: invalid ${what} (${result.error.message})`,
    );
  }
  return result.value;
}

function isSet<T extends object>(value: T | Record<string, never>): value is T {
  return Object.keys(value).length > 0;
}

/** Persistence ↔ aggregate mapping for {@link CheckoutSession}. Mapping only — no I/O. */
export class CheckoutSessionMapper {
  static toDomain(row: CheckoutSessionRow): CheckoutSession {
    const items = row.items.map((item) =>
      must(
        CheckoutItem.create(
          item.productRef,
          item.quantity,
          item.unitPriceAmountMinor,
          item.currency,
        ),
        "checkout item",
      ),
    );
    return CheckoutSession.reconstitute(
      UniqueEntityId.from(row.id),
      row.cartRef,
      row.customerRef ?? undefined,
      row.sessionRef,
      row.currency,
      CheckoutState.from(row.state as CheckoutStateValue),
      row.orderRef,
      items,
      row.version,
      {
        billingAddress: isSet(row.billingAddress)
          ? must(CheckoutAddress.create(row.billingAddress), "billing address")
          : undefined,
        contactEmail:
          row.contactEmail === null
            ? undefined
            : must(ContactEmail.create(row.contactEmail), "contact email"),
        shippingAddress: isSet(row.shippingAddress)
          ? must(CheckoutAddress.create(row.shippingAddress), "shipping address")
          : undefined,
        shippingSelection: isSet(row.shippingSelection)
          ? must(
              ShippingSelection.create(
                row.shippingSelection.method,
                row.shippingSelection.rateAmountMinor,
                row.shippingSelection.currency,
              ),
              "shipping selection",
            )
          : undefined,
        paymentSelection: isSet(row.paymentSelection)
          ? must(
              PaymentSelection.create(
                row.paymentSelection.paymentMethodRef,
                row.paymentSelection.provider,
              ),
              "payment selection",
            )
          : undefined,
        taxMinor: row.taxMinor ?? undefined,
        discountMinor: row.discountMinor ?? undefined,
        totals: isSet(row.totals)
          ? CheckoutTotals.assemble(
              items,
              row.totals.taxMinor,
              row.totals.shippingMinor,
              row.totals.discountMinor,
              row.totals.currency,
            )
          : undefined,
      },
    );
  }

  static toRow(session: CheckoutSession, tenantId: string) {
    return {
      id: session.id.toString(),
      tenantId,
      cartRef: session.cartRef,
      customerRef: session.customerRef ?? null,
      sessionRef: session.sessionRef,
      contactEmail: session.contactEmail?.value ?? null,
      currency: session.currency,
      state: session.state.value,
      orderRef: session.orderRef,
      items: session.items.map((item) => ({
        productRef: must(ProductRef.create(item.productRef), "product ref").value,
        quantity: item.quantity,
        unitPriceAmountMinor: item.unitPriceAmountMinor,
        currency: item.currency,
      })),
      billingAddress:
        session.billingAddress === undefined ? {} : toAddressJson(session.billingAddress),
      shippingAddress:
        session.shippingAddress === undefined ? {} : toAddressJson(session.shippingAddress),
      shippingSelection:
        session.shippingSelection === undefined
          ? {}
          : {
              method: session.shippingSelection.method,
              rateAmountMinor: session.shippingSelection.rateAmountMinor,
              currency: session.shippingSelection.currency,
            },
      paymentSelection:
        session.paymentSelection === undefined
          ? {}
          : {
              paymentMethodRef: session.paymentSelection.paymentMethodRef,
              provider: session.paymentSelection.provider,
            },
      taxMinor: session.taxMinor ?? null,
      discountMinor: session.discountMinor ?? null,
      totals:
        session.totals === undefined
          ? {}
          : {
              subtotalMinor: session.totals.subtotalMinor,
              taxMinor: session.totals.taxMinor,
              shippingMinor: session.totals.shippingMinor,
              discountMinor: session.totals.discountMinor,
              totalMinor: session.totals.totalMinor,
              currency: session.totals.currency,
            },
      version: 1,
    };
  }
}

function toAddressJson(address: CheckoutAddress): CheckoutAddressJson {
  return {
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    postalCode: address.postalCode,
    country: address.country,
  };
}
