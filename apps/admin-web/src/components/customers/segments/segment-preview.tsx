import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { SegmentMembersPage } from "@/lib/api/customer-segments";
import { customerCountLabel } from "@/lib/customers/segment-labels";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/** What the editor knows about its live preview right now. */
export type PreviewView =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ok"; readonly page: SegmentMembersPage }
  | { readonly status: "unavailable" }
  | { readonly status: "error" };

/**
 * The editor's live preview: how many customers the (unsaved) conditions match, and the first few.
 * A polite live region, so a screen reader hears the new count without the focus moving.
 */
export function SegmentPreview({
  view,
  t,
  locale,
}: {
  readonly view: PreviewView;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const k = t.segments.preview;

  return (
    <Card aria-busy={view.status === "loading"}>
      <CardHeader>
        <CardTitle className="text-lg">{k.heading}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3" aria-live="polite">
        {view.status === "idle" && <p className="text-muted-foreground text-sm">{k.hint}</p>}
        {view.status === "loading" && <p className="text-muted-foreground text-sm">{k.loading}</p>}
        {view.status === "unavailable" && (
          <p role="note" className="text-muted-foreground text-sm">
            {t.segments.unavailable}
          </p>
        )}
        {view.status === "error" && (
          <p role="alert" className="text-destructive text-sm">
            {k.error}
          </p>
        )}
        {view.status === "ok" && (
          <>
            <p className="text-base font-medium">
              {customerCountLabel(view.page.total, locale, t)}
            </p>
            {view.page.items.length === 0 ? (
              <p className="text-muted-foreground text-sm">{k.empty}</p>
            ) : (
              <>
                <p className="text-muted-foreground text-xs">
                  {k.sample.replace("{count}", String(view.page.items.length))}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {view.page.items.map((member) => (
                    <li key={member.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <bdi dir="auto" className="font-medium">
                        {member.name}
                      </bdi>
                      <bdi dir="auto" className="text-muted-foreground">
                        {member.email}
                      </bdi>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
