"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isPolicyType, type LocalizedText, type PolicyType } from "@platform/storefront-content";
import {
  generatePolicyTemplate,
  updatePolicy,
  type PolicyTemplateInputsDto,
} from "@/lib/api/online-store";
import { newIdempotencyKey, type LiveSaveState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { saveErrorState } from "@/lib/online-store/save-errors";
import { revalidateStorefront } from "@/lib/storefront-revalidate";
import type { Dictionary } from "@/messages/en";

/** A policy save's outcome; on success, the version the next save must send. */
export type PolicySaveState = LiveSaveState & { readonly version?: number };

export type PolicyTemplateState =
  | { readonly status: "ok"; readonly body: string }
  | { readonly status: "error"; readonly message: string };

const PAGE_PATH = "/settings/policies";

async function dictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

const isVersion = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** `{ ar?, en? }` with string values only, or null for anything else (an untrusted caller). */
function localizedOf(raw: unknown): LocalizedText | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { ar, en, ...rest } = raw as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (ar !== undefined && typeof ar !== "string") return null;
  if (en !== undefined && typeof en !== "string") return null;
  return { ...(ar === undefined ? {} : { ar }), ...(en === undefined ? {} : { en }) };
}

/**
 * `PUT /online-store/policies/:type` with the version the card loaded (one key per save). Live on
 * save: the storefront is told to drop its cached copy, and `liveDelayed` says when it could not be.
 */
export async function savePolicyAction(
  type: PolicyType,
  input: { body: LocalizedText; expectedVersion: number },
): Promise<PolicySaveState> {
  const t = await dictionary();
  const body = localizedOf(input?.body);
  if (!isPolicyType(type) || !isVersion(input?.expectedVersion) || body === null) {
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  }
  const result = await updatePolicy(
    type,
    { body, expectedVersion: input.expectedVersion },
    newIdempotencyKey(),
  );
  if (result.outcome !== "ok") return saveErrorState(result, t);
  revalidatePath(PAGE_PATH);
  const version = result.data.version;
  return (await revalidateStorefront())
    ? { status: "success", version }
    : { status: "success", liveDelayed: true, version };
}

/**
 * Starting text for one policy in one language (spec 2.3). The route is pure and NOT idempotent,
 * so no key is sent; nothing is saved, and the storefront is not touched.
 */
export async function generatePolicyTemplateAction(
  type: PolicyType,
  locale: "ar" | "en",
  inputs: PolicyTemplateInputsDto,
): Promise<PolicyTemplateState> {
  const t = await dictionary();
  if (!isPolicyType(type) || (locale !== "ar" && locale !== "en")) {
    return { status: "error", message: t.formErrors.invalid };
  }
  const result = await generatePolicyTemplate(type, { locale, inputs });
  switch (result.outcome) {
    case "ok":
      return { status: "ok", body: result.data.body };
    case "invalid":
      return { status: "error", message: t.policies.templateInvalid };
    case "unauthorized":
      return { status: "error", message: t.formErrors.unauthorized };
    case "forbidden":
      return { status: "error", message: t.formErrors.forbidden };
    default:
      return { status: "error", message: t.formErrors.unexpected };
  }
}
