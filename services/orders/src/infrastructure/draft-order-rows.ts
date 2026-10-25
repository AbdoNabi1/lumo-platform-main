import { UnexpectedError } from "@platform/utils";
import type { Prisma } from "@prisma/client";
import {
  DRAFT_ORDER_STATUSES,
  DraftOrder,
  type DraftAddress,
  type DraftDiscount,
  type DraftLine,
  type DraftOrderSnapshot,
  type DraftOrderStatus,
  type DraftShipping,
} from "../domain/draft-order";

/** The columns of `orders.draft_orders` as Prisma returns them (JSON columns untyped). */
export interface DraftOrderRow {
  readonly id: string;
  readonly draftNumber: string;
  readonly status: string;
  readonly currency: string;
  readonly customerRef: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly shippingAddress: unknown;
  readonly billingAddress: unknown;
  readonly lines: unknown;
  readonly discount: unknown;
  readonly shipping: unknown;
  readonly note: string | null;
  readonly tags: unknown;
  readonly checkoutRef: string | null;
  readonly checkoutVersion: number | null;
  readonly orderRef: string | null;
  readonly invoiceSentAt: Date | null;
  readonly completedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly createdBy: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isEmptyObject = (v: unknown): boolean => isObject(v) && Object.keys(v).length === 0;
const textOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

function corrupt(id: string, what: string): never {
  throw new UnexpectedError(`Corrupt draft order ${id}: invalid ${what}`);
}

function addressOf(id: string, raw: unknown): DraftAddress | null {
  if (raw === null || raw === undefined || isEmptyObject(raw)) return null;
  if (!isObject(raw)) return corrupt(id, "address");
  const line1 = textOrNull(raw["line1"]);
  const city = textOrNull(raw["city"]);
  const country = textOrNull(raw["country"]);
  if (line1 === null || city === null || country === null) return corrupt(id, "address");
  return {
    name: textOrNull(raw["name"]),
    phone: textOrNull(raw["phone"]),
    line1,
    line2: textOrNull(raw["line2"]),
    city,
    province: textOrNull(raw["province"]),
    postalCode: textOrNull(raw["postalCode"]) ?? "",
    country,
  };
}

function linesOf(id: string, raw: unknown): DraftLine[] {
  if (!Array.isArray(raw)) return corrupt(id, "lines");
  return raw.map((line: unknown) => {
    if (!isObject(line)) return corrupt(id, "line");
    const productRef = textOrNull(line["productRef"]);
    const variantRef = textOrNull(line["variantRef"]);
    const quantity = line["quantity"];
    const unitPriceMinor = line["unitPriceMinor"];
    if (
      productRef === null ||
      variantRef === null ||
      typeof quantity !== "number" ||
      typeof unitPriceMinor !== "number"
    ) {
      return corrupt(id, "line");
    }
    return {
      productRef,
      variantRef,
      sku: textOrNull(line["sku"]) ?? "",
      title: textOrNull(line["title"]) ?? "",
      variantTitle: textOrNull(line["variantTitle"]),
      quantity,
      unitPriceMinor,
    };
  });
}

function discountOf(id: string, raw: unknown): DraftDiscount | null {
  if (raw === null || raw === undefined || isEmptyObject(raw)) return null;
  if (!isObject(raw)) return corrupt(id, "discount");
  const valueType = raw["valueType"];
  const value = raw["value"];
  if ((valueType !== "fixed" && valueType !== "percentage") || typeof value !== "number") {
    return corrupt(id, "discount");
  }
  return { valueType, value, reason: textOrNull(raw["reason"]) };
}

function shippingOf(id: string, raw: unknown): DraftShipping | null {
  if (raw === null || raw === undefined || isEmptyObject(raw)) return null;
  if (!isObject(raw)) return corrupt(id, "shipping");
  const title = textOrNull(raw["title"]);
  const amountMinor = raw["amountMinor"];
  if (title === null || typeof amountMinor !== "number") return corrupt(id, "shipping");
  switch (raw["kind"]) {
    case "rate":
      return {
        kind: "rate",
        method: textOrNull(raw["method"]) ?? corrupt(id, "shipping method"),
        title,
        amountMinor,
      };
    case "custom":
      return { kind: "custom", title, amountMinor };
    case "free":
      return { kind: "free", title, amountMinor: 0 };
    default:
      return corrupt(id, "shipping kind");
  }
}

export function draftFromRow(row: DraftOrderRow): DraftOrder {
  if (!(DRAFT_ORDER_STATUSES as readonly string[]).includes(row.status)) {
    corrupt(row.id, "status");
  }
  if (!Array.isArray(row.tags)) corrupt(row.id, "tags");
  const tags = (row.tags as unknown[]).map((tag) =>
    typeof tag === "string" ? tag : corrupt(row.id, "tag"),
  );
  const snapshot: DraftOrderSnapshot = {
    id: row.id,
    draftNumber: row.draftNumber,
    status: row.status as DraftOrderStatus,
    currency: row.currency,
    customerRef: row.customerRef,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    shippingAddress: addressOf(row.id, row.shippingAddress),
    billingAddress: addressOf(row.id, row.billingAddress),
    lines: linesOf(row.id, row.lines),
    discount: discountOf(row.id, row.discount),
    shipping: shippingOf(row.id, row.shipping),
    note: row.note,
    tags,
    checkoutRef: row.checkoutRef,
    checkoutVersion: row.checkoutVersion,
    orderRef: row.orderRef,
    invoiceSentAt: row.invoiceSentAt,
    completedAt: row.completedAt,
    deletedAt: row.deletedAt,
    createdBy: row.createdBy,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return DraftOrder.reconstitute(snapshot);
}

/** A plain-JSON copy, typed as Prisma's JSON input (the typed interfaces are not assignable to it). */
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** The content columns — the ONLY columns `save` writes on an update (Ruling 2). */
export function contentColumns(draft: DraftOrder) {
  const s = draft.snapshot();
  return {
    customerRef: s.customerRef,
    contactEmail: s.contactEmail,
    contactPhone: s.contactPhone,
    shippingAddress: json(s.shippingAddress ?? {}),
    billingAddress: json(s.billingAddress ?? {}),
    lines: json(s.lines),
    discount: json(s.discount ?? {}),
    shipping: json(s.shipping ?? {}),
    note: s.note,
    tags: json(s.tags),
    updatedAt: s.updatedAt,
  };
}

/** Case-insensitive `contains` over the searchable fields (Ruling 16) — the in-memory mirror of the SQL. */
export function matchesDraftSearch(snapshot: DraftOrderSnapshot, search: string): boolean {
  const needle = search.toLowerCase();
  return [
    snapshot.draftNumber,
    snapshot.contactEmail,
    snapshot.contactPhone,
    snapshot.shippingAddress?.name,
    snapshot.shippingAddress?.phone,
  ].some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
}
