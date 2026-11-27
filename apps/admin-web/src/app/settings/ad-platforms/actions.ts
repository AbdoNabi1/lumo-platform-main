"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { fetchAdPlatforms, saveAdPlatform, type SaveAdPlatformInput } from "@/lib/api/ad-platforms";
import type { MutationResult } from "@/lib/api/client";
import { newIdempotencyKey } from "@/lib/api/mutation";
import {
  AD_PLATFORM_SPECS,
  inputNameForIssue,
  isAdPlatformKey,
  publicConfigFrom,
  samePublicConfig,
  type AdPlatformFormState,
  type AdPlatformKey,
  type ConnectionViewDto,
} from "@/lib/ad-platforms-model";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { revalidateStorefront } from "@/lib/storefront-revalidate";
import type { Dictionary } from "@/messages/en";

const AD_PLATFORMS_PATH = "/settings/ad-platforms";

async function currentDictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

/** The version the card loaded, as a hidden field: digits only, 0 meaning "no row yet". */
function readVersion(formData: FormData): number | undefined {
  const raw = formData.get("expectedVersion");
  return typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : undefined;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** What a refused save says, in the page's language. The token is never part of it. */
function refusal(
  platform: AdPlatformKey,
  result: Exclude<MutationResult<ConnectionViewDto>, { readonly outcome: "ok" }>,
  dictionary: Dictionary,
): AdPlatformFormState {
  const copy = dictionary.adPlatformsSettings;
  switch (result.outcome) {
    case "conflict":
      return { status: "error", message: copy.conflict, conflict: true };
    case "unauthorized":
      return { status: "error", message: dictionary.formErrors.unauthorized };
    case "forbidden":
      return { status: "error", message: dictionary.formErrors.forbidden };
    case "not_found":
      return { status: "error", message: dictionary.formErrors.notFound };
    case "invalid": {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.fields) {
        const input = inputNameForIssue(platform, issue.field);
        if (input === null) continue;
        fieldErrors[input] = input === "secret" ? copy.tokenInvalid : copy.fieldInvalid;
      }
      return { status: "error", message: dictionary.formErrors.invalid, fieldErrors };
    }
    case "error":
      // 503 UNAVAILABLE: a token was sent while the server has no real credential vault.
      return result.status === 503
        ? { status: "error", message: copy.unavailable }
        : { status: "error", message: dictionary.formErrors.unexpected };
  }
}

/**
 * Settings > Ad platforms: saves ONE platform's card (one save, one Idempotency-Key). `expectedVersion`
 * is the version the card holds; a stale one is a 409, never an overwrite. A blank token keeps the
 * saved one (nothing is sent); Remove token sends `clearSecret`. The token is write-only: it goes to
 * the API and is never in the returned state, an error message or a revalidated path. Every call
 * that reached the API refreshes the page; an ok save that changed the switch or the public ids
 * also tells the storefront (best effort), which renders them.
 */
export async function saveAdPlatformAction(
  _previous: AdPlatformFormState,
  formData: FormData,
): Promise<AdPlatformFormState> {
  const dictionary = await currentDictionary();
  const invalid = (fieldErrors?: Record<string, string>): AdPlatformFormState => ({
    status: "error",
    message: dictionary.formErrors.invalid,
    ...(fieldErrors === undefined ? {} : { fieldErrors }),
  });

  const platform = formData.get("platform");
  const expectedVersion = readVersion(formData);
  if (!isAdPlatformKey(platform) || expectedVersion === undefined) return invalid();
  const spec = AD_PLATFORM_SPECS[platform];

  const secret = text(formData, "secret");
  const clearSecret = formData.get("clearSecret") === "on";
  // Replacing a token and removing it in one save contradicts itself: refuse before any request.
  if (secret !== "" && clearSecret) return invalid({ secret: dictionary.formErrors.invalid });

  const values: Record<string, string> = {};
  for (const input of spec.idInputs) values[input.name] = text(formData, input.name);

  const enabled = formData.get("enabled") === "on";
  const publicConfig = publicConfigFrom(platform, values);
  const input: SaveAdPlatformInput = {
    enabled,
    publicConfig,
    expectedVersion,
    ...(secret === "" ? {} : { secret }),
    ...(clearSecret ? { clearSecret: true } : {}),
    ...(spec.testEventCode && formData.has("testEventCode")
      ? {
          testEventCode:
            text(formData, "testEventCode") === "" ? null : text(formData, "testEventCode"),
        }
      : {}),
  };

  // What was saved before, so the storefront is only told about what it renders (best effort).
  const before = await fetchAdPlatforms();
  const previous =
    before.outcome === "ok" ? before.items.find((item) => item.platform === platform) : undefined;

  const result = await saveAdPlatform(platform, input, newIdempotencyKey());
  revalidatePath(AD_PLATFORMS_PATH);

  if (result.outcome !== "ok") return refusal(platform, result, dictionary);

  const view = result.data;
  const changed =
    previous === undefined ||
    previous.enabled !== view.enabled ||
    !samePublicConfig(previous.publicConfig, view.publicConfig);
  if (changed) await revalidateStorefront();
  return { status: "success", view };
}
