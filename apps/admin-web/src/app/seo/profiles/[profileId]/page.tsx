import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, PencilIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { fetchSeoProfile } from "@/lib/api/seo";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface SeoProfileDetailPageProps {
  readonly params: Promise<{ readonly profileId: string }>;
}

/**
 * The SEO Profile Detail screen (T5.9b) — read-only display. Resolves the real
 * `GET /seo/profiles/:profileId` endpoint (`seo:read`). Editing means re-submitting the "set" form
 * with the same `pageRef` (`POST /seo/profiles` create-or-updates keyed by it, there is no separate
 * update route), so the "Edit" button here links to `/seo/profiles/new` pre-filled with this
 * record's current values.
 */
export default async function SeoProfileDetailPage({ params }: SeoProfileDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const { profileId } = await params;

  const result = await fetchSeoProfile(profileId);

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.seoProfileDetail.unauthorized}
        backLabel={t.seoProfileDetail.back}
      />
    );
  }
  if (result.outcome === "not_found") {
    return (
      <StatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={t.seoProfileDetail.notFound}
        backLabel={t.seoProfileDetail.back}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.seoProfileDetail.error}
        backLabel={t.seoProfileDetail.back}
      />
    );
  }

  const profile = result.profile;
  const editParams = new URLSearchParams();
  editParams.set("pageRef", profile.pageRef);
  if (profile.title !== null) editParams.set("title", profile.title);
  if (profile.description !== null) editParams.set("description", profile.description);
  if (profile.canonicalUrl !== null) editParams.set("canonicalUrl", profile.canonicalUrl);
  if (profile.ogImageRef !== null) editParams.set("ogImageRef", profile.ogImageRef);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
          <Link href="/seo/profiles">
            <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
            {t.seoProfileDetail.back}
          </Link>
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-4xl font-semibold tracking-tight">{profile.pageRef}</h1>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/seo/profiles/new?${editParams.toString()}`}>
              <PencilIcon aria-hidden="true" />
              {t.seoProfileDetail.edit}
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label={t.seoProfileForm.titleField} value={profile.title} t={t} />
          <Field label={t.seoProfileForm.description} value={profile.description} t={t} />
          <Field label={t.seoProfileForm.canonicalUrl} value={profile.canonicalUrl} t={t} />
          <Field label={t.seoProfileForm.ogImageRef} value={profile.ogImageRef} t={t} />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  t,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly t: { readonly seoProfileDetail: { readonly none: string } };
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono text-sm">{value ?? t.seoProfileDetail.none}</span>
    </div>
  );
}

function StatePanel({
  icon,
  message,
  backLabel,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly backLabel: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-4 px-4 py-12 text-center sm:px-5">
          {icon}
          <p role="note">{message}</p>
          <Button variant="outline" asChild>
            <Link href="/seo/profiles">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
