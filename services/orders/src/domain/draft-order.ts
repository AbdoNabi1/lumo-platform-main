import { err, ok, type Result } from "@platform/types";
import {
  BusinessRuleError,
  type DomainError,
  type FieldIssue,
  ValidationError,
} from "@platform/utils";
import { characterCount, MAX_TAGS_PER_ORDER, normalizeNote, parseTags } from "./order-tags";

/** What a draft is (spec §4.2) — mirrored by the migration's CHECK. */
export const DRAFT_ORDER_STATUSES = ["open", "invoice_sent", "completed"] as const;
export type DraftOrderStatus = (typeof DRAFT_ORDER_STATUSES)[number];

/** Spec §4.3 and Ruling 20. */
export const MAX_DRAFT_LINES = 100;
export const MAX_DRAFT_LINE_QUANTITY = 9999;
/** Spec §4.8: merchant-entered amounts are ≥ 0 and ≤ 10,000,000 minor units. */
export const MAX_DRAFT_AMOUNT_MINOR = 10_000_000;
/**
 * Catalog unit prices and server-quoted shipping rates are NOT merchant-entered, so the cap above
 * does not apply to them (spec §4.8). They only have to fit Checkout's INT4 money columns.
 */
export const MAX_DRAFT_INT4_MINOR = 2_147_483_647;
export const DRAFT_PAGE_SIZE_MAX = 50;
export const DRAFT_SEARCH_MAX_LENGTH = 100;
/** Ruling 13: the API's own fallback title; admin-web always sends a localized reason. */
export const DEFAULT_DRAFT_DISCOUNT_TITLE = "Custom discount";
export const FREE_SHIPPING_TITLE = "Free shipping";
const MAX_REASON_LENGTH = 255;
const MAX_SHIPPING_TITLE_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 32;
const MAX_ADDRESS_FIELD_LENGTH = 200;
const MAX_POSTAL_CODE_LENGTH = 32;
const MAX_CUSTOMER_REF_LENGTH = 64;
const MAX_SHIPPING_METHOD_LENGTH = 200;
const MAX_FREE_SHIPPING_TITLE_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIVE_STATUSES: readonly DraftOrderStatus[] = ["open", "invoice_sent"];

export interface DraftAddress {
  readonly name: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  /** ISO 3166-2; checked against the country by Checkout's address rule in the admin route. */
  readonly province: string | null;
  readonly postalCode: string;
  /** ISO 3166-1 alpha-2, upper case. */
  readonly country: string;
}

/** A catalog variant, priced SERVER-side at the last save (Ruling 12). */
export interface DraftLine {
  readonly productRef: string;
  readonly variantRef: string;
  readonly sku: string;
  readonly title: string;
  readonly variantTitle: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: number;
}

export interface DraftDiscount {
  readonly valueType: "fixed" | "percentage";
  /** Minor units (fixed) or a whole percentage 0–100. */
  readonly value: number;
  /** Shown as the discount's title; null → {@link DEFAULT_DRAFT_DISCOUNT_TITLE}. */
  readonly reason: string | null;
}

export type DraftShipping =
  | {
      readonly kind: "rate";
      readonly method: string;
      readonly title: string;
      readonly amountMinor: number;
    }
  | { readonly kind: "custom"; readonly title: string; readonly amountMinor: number }
  | { readonly kind: "free"; readonly title: string; readonly amountMinor: number };

export interface DraftOrderContent {
  readonly customerRef: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly shippingAddress: DraftAddress | null;
  /** null = same as shipping. */
  readonly billingAddress: DraftAddress | null;
  readonly lines: readonly DraftLine[];
  readonly discount: DraftDiscount | null;
  readonly shipping: DraftShipping | null;
  readonly note: string | null;
  readonly tags: readonly string[];
}

export interface DraftOrderSnapshot extends DraftOrderContent {
  readonly id: string;
  readonly draftNumber: string;
  readonly status: DraftOrderStatus;
  readonly currency: string;
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

/** What a draft still needs before an invoice can be sent or the order created (spec §4.5). */
export type DraftRequirement = "lines" | "shipping_address" | "shipping" | "email";

export interface DraftAmounts {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly shippingMinor: number;
  /** subtotal − discount + shipping; tax is added by the caller (Checkout's tax port). */
  readonly totalBeforeTaxMinor: number;
}

/** Spec §4.3: one order-level discount on the subtotal, capped at it; never a negative total. */
export function draftAmounts(
  content: Pick<DraftOrderContent, "lines" | "discount" | "shipping">,
): DraftAmounts {
  const subtotalMinor = content.lines.reduce(
    (sum, line) => sum + line.unitPriceMinor * line.quantity,
    0,
  );
  const discount = content.discount;
  const raw =
    discount === null
      ? 0
      : discount.valueType === "fixed"
        ? discount.value
        : Math.round((subtotalMinor * discount.value) / 100);
  const discountMinor = Math.max(0, Math.min(raw, subtotalMinor));
  const shippingMinor = content.shipping?.amountMinor ?? 0;
  return {
    subtotalMinor,
    discountMinor,
    shippingMinor,
    totalBeforeTaxMinor: subtotalMinor - discountMinor + shippingMinor,
  };
}

export function draftRequirements(
  content: DraftOrderContent,
  purpose: "invoice" | "complete",
): DraftRequirement[] {
  const missing: DraftRequirement[] = [];
  if (content.lines.length === 0) missing.push("lines");
  if (content.shippingAddress === null) missing.push("shipping_address");
  if (content.shipping === null) missing.push("shipping");
  // Spec §4.5 decision: Identity resolves guest customers by email only.
  if (purpose === "complete" && content.customerRef === null && content.contactEmail === null) {
    missing.push("email");
  }
  return missing;
}

export function normalizeDraftSearch(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().replace(/^#/, "").trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  return trimmed.slice(0, DRAFT_SEARCH_MAX_LENGTH);
}

export function clampDraftPageSize(first: number | undefined): number {
  if (first === undefined || !Number.isFinite(first)) return DRAFT_PAGE_SIZE_MAX;
  return Math.max(1, Math.min(Math.trunc(first), DRAFT_PAGE_SIZE_MAX));
}

export function isLiveDraftStatus(status: DraftOrderStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

/** A merchant-entered amount (fixed discount, custom shipping). */
function isAmount(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_DRAFT_AMOUNT_MINOR;
}

/** A catalog price or a quoted rate: any non-negative integer Checkout's INT4 columns can hold. */
function isQuotedAmount(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_DRAFT_INT4_MINOR;
}

function checkLength(value: string | null, max: number, field: string, issues: FieldIssue[]): void {
  if (value !== null && characterCount(value) > max) {
    issues.push({ field, message: `at most ${max} characters` });
  }
}

function normalizeAddress(
  raw: DraftAddress | null,
  prefix: string,
  issues: FieldIssue[],
): DraftAddress | null {
  if (raw === null) return null;
  const required = (field: "line1" | "city" | "country", value: string): string => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_ADDRESS_FIELD_LENGTH) {
      issues.push({ field: `${prefix}.${field}`, message: "required" });
    }
    return trimmed;
  };
  const country = required("country", raw.country).toUpperCase();
  if (country.length > 0 && !/^[A-Z]{2}$/.test(country)) {
    issues.push({ field: `${prefix}.country`, message: "must be a two-letter country code" });
  }
  const phone = blankToNull(raw.phone);
  if (phone !== null && phone.length > MAX_PHONE_LENGTH) {
    issues.push({ field: `${prefix}.phone`, message: `at most ${MAX_PHONE_LENGTH} characters` });
  }
  const name = blankToNull(raw.name);
  const line2 = blankToNull(raw.line2);
  const province = blankToNull(raw.province);
  const postalCode = raw.postalCode.trim();
  checkLength(name, MAX_ADDRESS_FIELD_LENGTH, `${prefix}.name`, issues);
  checkLength(line2, MAX_ADDRESS_FIELD_LENGTH, `${prefix}.line2`, issues);
  checkLength(province, MAX_ADDRESS_FIELD_LENGTH, `${prefix}.province`, issues);
  checkLength(postalCode, MAX_POSTAL_CODE_LENGTH, `${prefix}.postalCode`, issues);
  return {
    name,
    phone,
    line1: required("line1", raw.line1),
    line2,
    city: required("city", raw.city),
    province,
    postalCode,
    country,
  };
}

function normalizeLines(raw: readonly DraftLine[], issues: FieldIssue[]): DraftLine[] {
  if (raw.length === 0) {
    issues.push({ field: "lines", message: "add at least one product" });
    return [];
  }
  if (raw.length > MAX_DRAFT_LINES) {
    issues.push({ field: "lines", message: `at most ${MAX_DRAFT_LINES} products` });
    return [];
  }
  // Keyed by variant; `index` is the FIRST input row of the variant, so an over-cap error after a
  // merge names a row the caller actually sent.
  const merged = new Map<string, { readonly line: DraftLine; readonly index: number }>();
  raw.forEach((line, index) => {
    const quantityOk =
      Number.isInteger(line.quantity) &&
      line.quantity >= 1 &&
      line.quantity <= MAX_DRAFT_LINE_QUANTITY;
    if (!quantityOk) {
      issues.push({ field: `lines.${index}.quantity`, message: `1-${MAX_DRAFT_LINE_QUANTITY}` });
      return;
    }
    if (!isQuotedAmount(line.unitPriceMinor)) {
      issues.push({ field: `lines.${index}.unitPriceMinor`, message: "invalid price" });
      return;
    }
    const key = `${line.productRef}|${line.variantRef}`;
    const seen = merged.get(key);
    merged.set(
      key,
      seen === undefined
        ? { line: { ...line }, index }
        : {
            line: { ...seen.line, quantity: seen.line.quantity + line.quantity },
            index: seen.index,
          },
    );
  });
  for (const { line, index } of merged.values()) {
    if (line.quantity > MAX_DRAFT_LINE_QUANTITY) {
      issues.push({ field: `lines.${index}.quantity`, message: `1-${MAX_DRAFT_LINE_QUANTITY}` });
    }
  }
  return [...merged.values()].map(({ line }) => line);
}

function normalizeDiscount(raw: DraftDiscount | null, issues: FieldIssue[]): DraftDiscount | null {
  if (raw === null) return null;
  const valid =
    raw.valueType === "fixed"
      ? isAmount(raw.value)
      : Number.isInteger(raw.value) && raw.value >= 0 && raw.value <= 100;
  if (!valid) issues.push({ field: "discount.value", message: "out of range" });
  const reason = blankToNull(raw.reason);
  if (reason !== null && characterCount(reason) > MAX_REASON_LENGTH) {
    issues.push({ field: "discount.reason", message: `at most ${MAX_REASON_LENGTH} characters` });
  }
  if (raw.value === 0) return null;
  return { valueType: raw.valueType, value: raw.value, reason };
}

function normalizeShipping(raw: DraftShipping | null, issues: FieldIssue[]): DraftShipping | null {
  if (raw === null) return null;
  if (raw.kind === "free") {
    const freeTitle = blankToNull(raw.title);
    checkLength(freeTitle, MAX_FREE_SHIPPING_TITLE_LENGTH, "shipping.title", issues);
    return { kind: "free", title: freeTitle ?? FREE_SHIPPING_TITLE, amountMinor: 0 };
  }
  // A custom amount is merchant-entered (capped); a rate was quoted by the server (INT4 only).
  const amountOk =
    raw.kind === "rate" ? isQuotedAmount(raw.amountMinor) : isAmount(raw.amountMinor);
  if (!amountOk) issues.push({ field: "shipping.amountMinor", message: "out of range" });
  if (raw.kind === "rate") {
    checkLength(raw.method, MAX_SHIPPING_METHOD_LENGTH, "shipping.method", issues);
  }
  const title = raw.title.trim();
  if (title.length === 0 || characterCount(title) > MAX_SHIPPING_TITLE_LENGTH) {
    issues.push({ field: "shipping.title", message: `1-${MAX_SHIPPING_TITLE_LENGTH} characters` });
  }
  return raw.kind === "rate"
    ? { kind: "rate", method: raw.method, title, amountMinor: raw.amountMinor }
    : { kind: "custom", title, amountMinor: raw.amountMinor };
}

/** Every rule a draft's content obeys (spec §4.3, Ruling 20). Field names match the API's input. */
export function normalizeDraftContent(
  raw: DraftOrderContent,
): Result<DraftOrderContent, ValidationError> {
  const issues: FieldIssue[] = [];
  const lines = normalizeLines(raw.lines, issues);
  const discount = normalizeDiscount(raw.discount, issues);
  const shipping = normalizeShipping(raw.shipping, issues);
  // The sum is exact: 100 lines x 9,999 x INT4 max is about 2.1e15, below Number.MAX_SAFE_INTEGER
  // (about 9.0e15), and merging variants keeps the sum — so this check cannot itself overflow.
  const subtotal = lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
  if (subtotal + (shipping?.amountMinor ?? 0) > MAX_DRAFT_INT4_MINOR) {
    issues.push({ field: "lines", message: "total too large" });
  }
  const customerRef = blankToNull(raw.customerRef);
  checkLength(customerRef, MAX_CUSTOMER_REF_LENGTH, "customerRef", issues);
  const contactEmail = blankToNull(raw.contactEmail);
  if (
    contactEmail !== null &&
    (contactEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(contactEmail))
  ) {
    issues.push({ field: "email", message: "is not an email address" });
  }
  const contactPhone = blankToNull(raw.contactPhone);
  if (contactPhone !== null && contactPhone.length > MAX_PHONE_LENGTH) {
    issues.push({ field: "phone", message: `at most ${MAX_PHONE_LENGTH} characters` });
  }
  const shippingAddress = normalizeAddress(raw.shippingAddress, "shippingAddress", issues);
  const billingAddress = normalizeAddress(raw.billingAddress, "billingAddress", issues);
  const note = normalizeNote(raw.note);
  if (!note.ok) issues.push({ field: "note", message: note.error.message });
  const tags = parseTags(raw.tags);
  if (!tags.ok) issues.push({ field: "tags", message: tags.error.message });
  else if (tags.value.length > MAX_TAGS_PER_ORDER) {
    issues.push({ field: "tags", message: `at most ${MAX_TAGS_PER_ORDER} tags` });
  }
  if (issues.length > 0 || !note.ok || !tags.ok) {
    return err(new ValidationError("Invalid draft order", issues));
  }
  return ok({
    customerRef,
    contactEmail,
    contactPhone,
    shippingAddress,
    billingAddress,
    lines,
    discount,
    shipping,
    note: note.value,
    tags: tags.value.map((tag) => tag.tag),
  });
}

type Props = { -readonly [K in keyof DraftOrderSnapshot]: DraftOrderSnapshot[K] };

export interface CreateDraftOrderProps {
  readonly id: string;
  readonly draftNumber: string;
  readonly currency: string;
  readonly createdBy: string;
  readonly now: Date;
  readonly content: DraftOrderContent;
}

/**
 * A merchant's draft order (spec §4.1). Its CONTENT is revised with optimistic locking; its status,
 * checkout and deletion are moved only by the repository's guarded writes (Ruling 2), so this class
 * has no method that changes them — a stale instance can never undo a completion.
 */
export class DraftOrder {
  private readonly props: Props;
  private persisted: boolean;

  private constructor(props: Props, isNew: boolean) {
    this.props = props;
    this.persisted = !isNew;
  }

  /** True until inserted: `save` inserts a new draft and updates the content of a loaded one. */
  get isNew(): boolean {
    return !this.persisted;
  }

  /** Called by a repository after a successful insert, so a second `save` updates, not re-inserts. */
  markPersisted(): void {
    this.persisted = true;
  }

  static create(input: CreateDraftOrderProps): Result<DraftOrder, ValidationError> {
    const content = normalizeDraftContent(input.content);
    if (!content.ok) return err(content.error);
    return ok(
      new DraftOrder(
        {
          ...content.value,
          id: input.id,
          draftNumber: input.draftNumber,
          status: "open",
          currency: input.currency,
          checkoutRef: null,
          checkoutVersion: null,
          orderRef: null,
          invoiceSentAt: null,
          completedAt: null,
          deletedAt: null,
          createdBy: input.createdBy,
          version: 0,
          createdAt: input.now,
          updatedAt: input.now,
        },
        true,
      ),
    );
  }

  static reconstitute(snapshot: DraftOrderSnapshot): DraftOrder {
    return new DraftOrder({ ...snapshot }, false);
  }

  /** Not completed and not deleted. */
  get isEditable(): boolean {
    return isLiveDraftStatus(this.props.status) && this.props.deletedAt === null;
  }

  revise(content: DraftOrderContent, now: Date): Result<void, DomainError> {
    if (this.props.deletedAt !== null) {
      return err(new BusinessRuleError("DRAFT_DELETED: this draft order was deleted"));
    }
    if (this.props.status === "completed") {
      return err(new BusinessRuleError("DRAFT_COMPLETED: this draft order is already an order"));
    }
    const normalized = normalizeDraftContent(content);
    if (!normalized.ok) return err(normalized.error);
    Object.assign(this.props, normalized.value, { updatedAt: now });
    return ok(undefined);
  }

  content(): DraftOrderContent {
    const p = this.props;
    return {
      customerRef: p.customerRef,
      contactEmail: p.contactEmail,
      contactPhone: p.contactPhone,
      shippingAddress: p.shippingAddress,
      billingAddress: p.billingAddress,
      lines: p.lines,
      discount: p.discount,
      shipping: p.shipping,
      note: p.note,
      tags: p.tags,
    };
  }

  snapshot(): DraftOrderSnapshot {
    return { ...this.props };
  }

  get id(): string {
    return this.props.id;
  }
  get draftNumber(): string {
    return this.props.draftNumber;
  }
  get status(): DraftOrderStatus {
    return this.props.status;
  }
  get currency(): string {
    return this.props.currency;
  }
  get customerRef(): string | null {
    return this.props.customerRef;
  }
  get contactEmail(): string | null {
    return this.props.contactEmail;
  }
  get contactPhone(): string | null {
    return this.props.contactPhone;
  }
  get shippingAddress(): DraftAddress | null {
    return this.props.shippingAddress;
  }
  get billingAddress(): DraftAddress | null {
    return this.props.billingAddress;
  }
  get lines(): readonly DraftLine[] {
    return this.props.lines;
  }
  get discount(): DraftDiscount | null {
    return this.props.discount;
  }
  get shipping(): DraftShipping | null {
    return this.props.shipping;
  }
  get note(): string | null {
    return this.props.note;
  }
  get tags(): readonly string[] {
    return this.props.tags;
  }
  get checkoutRef(): string | null {
    return this.props.checkoutRef;
  }
  get checkoutVersion(): number | null {
    return this.props.checkoutVersion;
  }
  get orderRef(): string | null {
    return this.props.orderRef;
  }
  get invoiceSentAt(): Date | null {
    return this.props.invoiceSentAt;
  }
  get completedAt(): Date | null {
    return this.props.completedAt;
  }
  get deletedAt(): Date | null {
    return this.props.deletedAt;
  }
  get createdBy(): string {
    return this.props.createdBy;
  }
  get version(): number {
    return this.props.version;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
