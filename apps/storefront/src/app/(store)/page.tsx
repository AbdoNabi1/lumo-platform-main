import { Sections } from "@/components/sections/sections";
import { AvailabilityBook } from "@/lib/catalog";
import { getHomepage } from "@/lib/homepage";
import { dictionaryFor } from "@/lib/i18n";
import { getPreviewToken, getRequestLocale, getRequestShell } from "@/lib/request-locale";
import { currentShopId } from "@/lib/runtime-api";
import { loadSectionData } from "@/lib/section-data";

/**
 * Storefront home: the shop's homepage sections (spec 3.4). A shop that has saved none sees the
 * default layout (newest products, then all collections), which `getHomepage` supplies. The token
 * is passed on only when the Runtime itself called this shell a preview (`getHomepage` then reads
 * the draft, uncached). The availability book is loaded here, per request, outside any cache.
 */
export default async function Home() {
  const [locale, shell, token] = await Promise.all([
    getRequestLocale(),
    getRequestShell(),
    getPreviewToken(),
  ]);
  const t = dictionaryFor(locale);
  const storeName = shell.storeName.trim();
  const previewToken = token !== null && shell.mode === "preview" ? token : null;

  const home = await getHomepage(previewToken);
  const shopId = await currentShopId();
  const [data, availability] = await Promise.all([
    loadSectionData(shopId, home.sections),
    AvailabilityBook.load(),
  ]);
  const eagerHeroId = home.sections.find((section) => section.type === "hero")?.id ?? null;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-8">
      {/* The page's one h1 (the sections start at h2): the shop's name, for screen readers. */}
      <h1 className="sr-only">
        <bdi dir="auto">{storeName !== "" ? storeName : t.home.title}</bdi>
      </h1>
      <Sections
        sections={home.sections}
        data={data}
        availability={availability}
        t={t}
        locale={locale}
        previewToken={previewToken}
        mode={home.mode}
        eagerHeroId={eagerHeroId}
      />
    </main>
  );
}
