"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { addMyDomain, makeMyDomainPrimary, verifyMyDomain } from "@/lib/api/store-domains";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Settings → Domains. Same shape every write action follows: parse the form defensively, mint one
 * idempotency key per submit, call the typed `lib/api/store-domains.ts` function and project any
 * non-`ok` outcome through `toFormState`. The runtime answers 409 for three different reasons
 * (hostname already used, DNS not pointing at the platform yet, domain not verified), so each action
 * replaces the raw server sentence with its own localized copy.
 */

const PATH = "/settings/domains";

async function dictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** "  HTTPS://Shop.Example.com/ " → "shop.example.com". The API still validates the hostname. */
function normalizeHostname(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/\/+$/, "");
}

/** Connects a custom domain; it stays pending until its DNS is verified. */
export async function addDomainAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const hostname = normalizeHostname(text(formData, "hostname"));
  if (hostname.length === 0) {
    return {
      status: "error",
      message: t.formErrors.invalid,
      fieldErrors: { hostname: t.formErrors.invalid },
    };
  }

  const result = await addMyDomain(hostname, newIdempotencyKey());
  if (result.outcome === "conflict") {
    return {
      status: "error",
      message: t.domainsPage.errorAlreadyConnected,
      fieldErrors: {},
    };
  }
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);

  revalidatePath(PATH);
  return { status: "success" };
}

/** Checks the custom domain's DNS; a 409 means it does not point at the platform yet. */
export async function verifyDomainAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const domainId = text(formData, "domainId");
  if (domainId.length === 0) {
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  }

  const result = await verifyMyDomain(domainId, newIdempotencyKey());
  if (result.outcome === "conflict") {
    return {
      status: "error",
      message: t.domainsPage.errorDnsNotReady,
      fieldErrors: {},
    };
  }
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);

  revalidatePath(PATH);
  return { status: "success" };
}

/** Makes a connected domain the one customers are sent to. */
export async function makeDomainPrimaryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const domainId = text(formData, "domainId");
  if (domainId.length === 0) {
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  }

  const result = await makeMyDomainPrimary(domainId, newIdempotencyKey());
  if (result.outcome === "conflict") {
    return {
      status: "error",
      message: t.domainsPage.errorNotVerified,
      fieldErrors: {},
    };
  }
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);

  revalidatePath(PATH);
  return { status: "success" };
}
