"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import {
  acceptReturnItems,
  advanceReturn,
  createReturn,
  decideReturn,
  generateReturnRma,
  receiveReturnPackage,
  recordReturnInspection,
  resolveReturn,
  type AcceptReturnItemInput,
  type CreateReturnItemInput,
  type ReturnResolutionOutcome,
} from "@/lib/api/returns";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.3 — the Returns detail screen's write actions (`app/orders/[orderId]/returns/page.tsx`).
 * Same shape every write action in this app follows (`app/orders/actions.ts`'s own T5.2 doc
 * comment, `apps/admin-web/README.md`'s recipe): parse `FormData` defensively (never trust a
 * hidden field or a closure variable — re-derive `orderId`/`returnId` from the submission itself),
 * mint exactly one idempotency key per submit, call the typed `lib/api/returns.ts` function, and
 * project any non-`ok` outcome through `toFormState`.
 *
 * Kept in this route's own `actions.ts` (not `app/orders/actions.ts`) since Returns is its own
 * write surface with its own route segment, per the recipe's step 3 ("Add a `use server` action in
 * `apps/admin-web/src/app/<route>/actions.ts`") — `app/orders/actions.ts` is T5.2's file and stays
 * untouched by this task.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name);
  return value.length > 0 ? value : undefined;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

/** Both screens that show return data — the Order Detail card and this route's own page. */
function revalidateReturnsScreens(orderId: string): void {
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/returns`);
}

/**
 * Reads the checked order items off `ReturnCreateForm`'s `includeItem` checkboxes (their values
 * are the included `orderItemRef`s directly — no positional array alignment needed) and, for each
 * one, its companion `productRef_<ref>`/`quantity_<ref>`/`reasonCode_<ref>`/`reasonNote_<ref>`
 * fields, keyed explicitly by that same ref rather than by array position.
 */
function parseReturnCreateItems(formData: FormData): readonly CreateReturnItemInput[] | null {
  const includedRefs = formData
    .getAll("includeItem")
    .map((value) => (typeof value === "string" ? value : ""));
  if (includedRefs.length === 0) return null;

  const items: CreateReturnItemInput[] = [];
  for (const orderItemRef of includedRefs) {
    if (orderItemRef.length === 0) return null;
    const productRef = stringField(formData, `productRef_${orderItemRef}`);
    const quantity = Number.parseInt(stringField(formData, `quantity_${orderItemRef}`), 10);
    const reasonCode = stringField(formData, `reasonCode_${orderItemRef}`);
    const reasonNote = optionalStringField(formData, `reasonNote_${orderItemRef}`);
    if (
      productRef.length === 0 ||
      reasonCode.length === 0 ||
      Number.isNaN(quantity) ||
      quantity <= 0
    ) {
      return null;
    }
    items.push({ orderItemRef, productRef, quantity, reasonCode, reasonNote });
  }
  return items;
}

/** Opens a return request (`ReturnCreateForm`, shown when `fetchReturnByOrder` is `not_found`). */
export async function createReturnAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderRef = stringField(formData, "orderRef");
  const items = parseReturnCreateItems(formData);
  if (orderRef.length === 0 || items === null) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: items === null ? { items: t.invalid } : {},
    };
  }

  const result = await createReturn({ orderRef, items }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateReturnsScreens(orderRef);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Approves or rejects the return (`DecisionForm`, only offered at `requested`). */
export async function decideReturnAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const returnId = stringField(formData, "returnId");
  const approvedRaw = stringField(formData, "approved");
  if (
    orderId.length === 0 ||
    returnId.length === 0 ||
    (approvedRaw !== "true" && approvedRaw !== "false")
  ) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }
  const note = optionalStringField(formData, "note");

  const result = await decideReturn(returnId, approvedRaw === "true", note, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateReturnsScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Generates the RMA number (`RmaForm`, only offered at `approved`). */
export async function generateRmaAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const returnId = stringField(formData, "returnId");
  const rmaNumber = stringField(formData, "rmaNumber");
  if (orderId.length === 0 || returnId.length === 0 || rmaNumber.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: rmaNumber.length === 0 ? { rmaNumber: t.invalid } : {},
    };
  }

  const result = await generateReturnRma(returnId, rmaNumber, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateReturnsScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Records the returned package's receipt (`ReceiveForm`, only offered at `rma_generated`). */
export async function receiveReturnAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const returnId = stringField(formData, "returnId");
  const source = stringField(formData, "source");
  const callbackId = stringField(formData, "callbackId");
  if (
    orderId.length === 0 ||
    returnId.length === 0 ||
    source.length === 0 ||
    callbackId.length === 0
  ) {
    const fieldErrors: Record<string, string> = {};
    if (source.length === 0) fieldErrors["source"] = t.invalid;
    if (callbackId.length === 0) fieldErrors["callbackId"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await receiveReturnPackage(returnId, source, callbackId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateReturnsScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Records one item's inspection result (`InspectionForm`, only offered at `package_received`, one form per item). */
export async function recordInspectionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const returnId = stringField(formData, "returnId");
  const itemRef = stringField(formData, "itemRef");
  const passedRaw = stringField(formData, "passed");
  if (
    orderId.length === 0 ||
    returnId.length === 0 ||
    itemRef.length === 0 ||
    (passedRaw !== "true" && passedRaw !== "false")
  ) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }
  const note = optionalStringField(formData, "note");

  const result = await recordReturnInspection(
    returnId,
    itemRef,
    passedRaw === "true",
    note,
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidateReturnsScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Reads `AcceptForm`'s per-row disposition inputs. `candidateItemRef` (always present, one hidden
 * input per return item) supplies the full candidate set; a row is included only if its
 * `disposition_<ref>` field was filled in — rows left blank are simply not sent, rather than
 * forcing every item to be accepted in one submit.
 */
function parseAcceptItems(formData: FormData): readonly AcceptReturnItemInput[] | null {
  const candidates = formData
    .getAll("candidateItemRef")
    .map((value) => (typeof value === "string" ? value : ""));
  const items: AcceptReturnItemInput[] = [];
  for (const orderItemRef of candidates) {
    if (orderItemRef.length === 0) continue;
    const disposition = stringField(formData, `disposition_${orderItemRef}`);
    if (disposition.length > 0) {
      items.push({ orderItemRef, disposition });
    }
  }
  return items.length > 0 ? items : null;
}

/** Accepts inspected items with their dispositions (`AcceptForm`, only offered at `inspection_completed`). */
export async function acceptReturnItemsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const returnId = stringField(formData, "returnId");
  const items = parseAcceptItems(formData);
  if (orderId.length === 0 || returnId.length === 0 || items === null) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: items === null ? { items: t.invalid } : {},
    };
  }

  const result = await acceptReturnItems(returnId, items, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateReturnsScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Advances the return via the generic transitions route (`AdvanceForm`) — the fallback offered
 * only for a status with no dedicated action (`lib/return-lifecycle.ts`'s `hasDedicatedActionFrom`
 * / `advanceableReturnStatusesFrom`).
 */
export async function advanceReturnAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const returnId = stringField(formData, "returnId");
  const toStatus = stringField(formData, "toStatus");
  if (orderId.length === 0 || returnId.length === 0 || toStatus.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: toStatus.length === 0 ? { toStatus: t.invalid } : {},
    };
  }

  const result = await advanceReturn(returnId, toStatus, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateReturnsScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

function isResolutionOutcome(value: string): value is ReturnResolutionOutcome {
  return value === "refund" || value === "replacement" || value === "repair";
}

/** Decides the resolution for accepted items (`ResolutionForm`, only offered at `items_accepted`). */
export async function resolveReturnAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const returnId = stringField(formData, "returnId");
  const outcomeRaw = stringField(formData, "outcome");
  if (orderId.length === 0 || returnId.length === 0 || !isResolutionOutcome(outcomeRaw)) {
    return { status: "error", message: t.invalid, fieldErrors: { outcome: t.invalid } };
  }

  const amountRaw = stringField(formData, "amountMinor");
  let amountMinor: number | undefined;
  if (amountRaw.length > 0) {
    const parsed = Number.parseInt(amountRaw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return { status: "error", message: t.invalid, fieldErrors: { amountMinor: t.invalid } };
    }
    amountMinor = parsed;
  }
  const currency = optionalStringField(formData, "currency");

  const result = await resolveReturn(returnId, outcomeRaw, amountMinor, currency, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateReturnsScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}
