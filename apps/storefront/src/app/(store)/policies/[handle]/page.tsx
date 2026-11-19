import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { pickText, POLICY_TITLES, policyTypeOfSlug } from "@platform/storefront-content";
import { RichText } from "@/components/rich-text";
import { StatePanel } from "@/components/state-panel";
import { getPolicy } from "@/lib/content";
import { dictionaryFor } from "@/lib/i18n";
import { getRequestLocale, getRequestShell } from "@/lib/request-locale";

type Params = { readonly params: Promise<{ readonly handle: string }> };

/**
 * Spec 2.8: a store policy at Shopify's URL, `/policies/<slug>`. Only the five fixed slugs exist,
 * found by an exact-match scan (Ruling 7), so any other handle is a 404 before any read. A policy
 * that is not set is a 404; a failed read is the "unavailable" panel and nothing is cached (the
 * read throws inside its cache). This route stays reachable on a locked store (Ruling 5); the
 * layout then renders it without the shop's chrome. It has no server action.
 */
export default async function PolicyPage({ params }: Params) {
  const { handle } = await params;
  const type = policyTypeOfSlug(handle);
  if (type === null) notFound();
  const [read, locale] = await Promise.all([getPolicy(type), getRequestLocale()]);
  if (read.status === "not-found") notFound();
  const t = dictionaryFor(locale);
  if (read.status === "error") {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
        <StatePanel
          icon={<AlertTriangleIcon className="size-6" />}
          title={t.content.unavailableTitle}
          body={t.content.unavailable}
          action={{ href: "/", label: t.notFound.backHome }}
        />
      </main>
    );
  }
  const body = pickText(read.value.body, locale);
  if (body === null) notFound(); // a row with no text in either language is not set
  const { updatedAt } = read.value;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold">{POLICY_TITLES[type][locale]}</h1>
      {updatedAt === null ? null : (
        <p className="text-muted-foreground mt-2 text-sm">
          <time dateTime={updatedAt}>
            {t.content.lastUpdated.replace(
              "{date}",
              new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(updatedAt)),
            )}
          </time>
        </p>
      )}
      <RichText text={body} className="mt-6" />
    </main>
  );
}

/**
 * `<policy> | <store>` (just the policy title without a store name). A failed read is `noindex`
 * (the "unavailable" panel answers 200); an unknown handle or a policy that is not set adds nothing.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const type = policyTypeOfSlug(handle);
  if (type === null) return {};
  const [read, locale, shell] = await Promise.all([
    getPolicy(type),
    getRequestLocale(),
    getRequestShell(),
  ]);
  if (read.status === "error") return { robots: { index: false } };
  if (read.status !== "ok" || pickText(read.value.body, locale) === null) return {};
  const title = POLICY_TITLES[type][locale];
  // As in `metadataFor`: Next substitutes `%s`, so the store name must not bring its own.
  const name = shell.storeName.trim().replaceAll("%", "");
  return { title: { absolute: name === "" ? title : `${title} | ${name}` } };
}
