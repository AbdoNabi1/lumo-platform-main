import Link from "next/link";
import { InfoIcon } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { EmailSettingsDto } from "@/lib/api/outreach";
import { parseSender } from "@/lib/outreach/email";
import type { Dictionary } from "@/messages/en";

/** The sender line with the store name isolated (`<bdi dir="auto">`) inside the sentence ("{store} via Morbeh"). */
function SenderLine({ store, t }: { readonly store: string; readonly t: Dictionary }) {
  const [before = "", after = ""] = t.emailSettings.senderLine.split("{store}");
  return (
    <>
      {before}
      <bdi dir="auto">{store}</bdi>
      {after}
    </>
  );
}

/**
 * Settings → Email: who the customer sees the email come from. The sender reads "<store name> via Morbeh" with the from
 * address; replies go to the store's contact email (changed in General settings). When email isn't set up on the
 * platform, an info card says so. Presentational only: it needs no state.
 */
export function EmailSenderCard({
  settings,
  t,
}: {
  readonly settings: EmailSettingsDto;
  readonly t: Dictionary;
}) {
  const copy = t.emailSettings;
  const sender = parseSender(settings.from);

  if (!settings.available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2">{copy.unavailableTitle}</CardTitle>
          <Badge variant="neutral">{copy.statusUnavailable}</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p role="note" className="text-muted-foreground flex items-start gap-2 text-sm">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{copy.unavailableBody}</span>
          </p>
          <p className="text-muted-foreground text-sm">{copy.transactionalNote}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{copy.senderTitle}</CardTitle>
        <Badge variant="success">{copy.statusAvailable}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{copy.sender}</dt>
            <dd className="font-medium">
              {sender.name !== null ? <SenderLine store={sender.name} t={t} /> : "—"}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{copy.fromAddress}</dt>
            <dd className="font-medium">
              <bdi dir="ltr">{sender.address ?? "—"}</bdi>
            </dd>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <dt className="text-muted-foreground">{copy.replyTo}</dt>
            <dd className="font-medium">
              {settings.replyTo !== null ? (
                <bdi dir="ltr">{settings.replyTo}</bdi>
              ) : (
                <span className="text-muted-foreground font-normal">{copy.replyToMissing}</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="text-sm">
          <Link href="/settings/general" className="text-primary hover:underline">
            {copy.changeReplyTo}
          </Link>
        </p>
        <p className="text-muted-foreground text-sm">{copy.transactionalNote}</p>
      </CardContent>
    </Card>
  );
}
