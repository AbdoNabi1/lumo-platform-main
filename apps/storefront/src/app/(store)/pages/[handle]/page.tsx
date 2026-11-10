import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { PAGE_HANDLE_PATTERN, pickText } from "@platform/storefront-content";
import { RichText } from "@/components/rich-text";
import { StatePanel } from "@/components/state-panel";
import { getPage } from "@/lib/content";
import { dictionaryFor } from "@/lib/i18n";
import { getRequestLocale, getRequestShell } from "@/lib/request-locale";

type Params = { readonly params: Promise<{ readonly handle: string }> };

/**
 * Spec 2.8: a published page at `/pages/<handle>`. A malformed handle is a 404 before any read
 * (Review Focus 5); so is a page the Runtime does not have. A failed read is the "unavailable"
 * panel, never a 404, so a hiccup cannot make a live page look deleted. The title is the shop's
 * own text, isolated; the body is Morbeh text through `RichText`.
 */
export default async function ContentPage({ params }: Params) {
  const { handle } = await params;
  if (!PAGE_HANDLE_PATTERN.test(handle)) notFound();
  const [read, locale] = await Promise.all([getPage(handle), getRequestLocale()]);
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
  const title = pickText(read.value.title, locale);
  const body = pickText(read.value.body, locale);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      {title === null ? null : (
        <h1 className="text-3xl font-semibold" dir="auto">
          <bdi>{title}</bdi>
        </h1>
      )}
      {body === null ? null : <RichText text={body} className="mt-6" />}
    </main>
  );
}

/** `<title> | <store>` (just the title without a store name), and the meta description. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  if (!PAGE_HANDLE_PATTERN.test(handle)) return {};
  const [read, locale, shell] = await Promise.all([
    getPage(handle),
    getRequestLocale(),
    getRequestShell(),
  ]);
  if (read.status !== "ok") return {};
  const title = pickText(read.value.title, locale);
  const description = pickText(read.value.metaDescription, locale);
  // As in `metadataFor`: Next substitutes `%s`, so the store name must not bring its own.
  const name = shell.storeName.trim().replaceAll("%", "");
  return {
    ...(title === null ? {} : { title: { absolute: name === "" ? title : `${title} | ${name}` } }),
    ...(description === null ? {} : { description }),
  };
}
