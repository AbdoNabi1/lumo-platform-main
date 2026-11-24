"use client";

import { useRef, useState, useTransition } from "react";
import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@platform/ui";
import {
  abandonOnboardingAction,
  disconnectWhatsAppAction,
  refreshWhatsAppAction,
  type WhatsAppActionState,
} from "@/app/settings/whatsapp/actions";
import type { WhatsAppConnectionDto, WhatsAppTemplateDto } from "@/lib/api/outreach";
import { limitSentence, qualityBadge, whatsappErrorMessage } from "@/lib/outreach/whatsapp";
import type { Dictionary } from "@/messages/en";
import { BrandText } from "./brand-text";
import { ConfirmDialog } from "./confirm-dialog";
import { EmbeddedSignupButton } from "./embedded-signup-button";
import { TestSendForm } from "./test-send-form";

type Notice = { readonly tone: "info" | "error"; readonly text: string } | null;

function formatDate(iso: string | null, locale: string): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  // UTC keeps the server render and the browser's hydration identical.
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function StatusBadge({ status, t }: { status: WhatsAppConnectionDto["status"]; t: Dictionary }) {
  const copy = t.whatsappSettings;
  switch (status) {
    case "connected":
      return <Badge variant="success">{copy.statusConnected}</Badge>;
    case "error":
      return <Badge variant="warning">{copy.statusError}</Badge>;
    case "onboarding":
      return <Badge variant="info">{copy.statusOnboarding}</Badge>;
    default:
      return <Badge variant="neutral">{copy.statusNotConnected}</Badge>;
  }
}

/**
 * Settings → WhatsApp: the connection in one of its states. The merchant sees the phone number and the verified name,
 * never a business-account or phone-number id, and never a raw provider code (codes map to copy; the rest is generic).
 */
export function WhatsAppConnectionCard({
  connection: liveConnection,
  templates,
  t,
  locale,
}: {
  readonly connection: WhatsAppConnectionDto;
  /** `null` when the templates could not be loaded. */
  readonly templates: readonly WhatsAppTemplateDto[] | null;
  readonly t: Dictionary;
  readonly locale: string;
}) {
  const copy = t.whatsappSettings;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [showTest, setShowTest] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [retainedConnection, setRetainedConnection] = useState<WhatsAppConnectionDto | null>(null);
  const connection = retainedConnection ?? liveConnection;

  function report(result: WhatsAppActionState) {
    setNotice(result.status === "error" ? { tone: "error", text: result.message } : null);
  }

  const noticeLine = notice !== null && (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={
        notice.tone === "error" ? "text-destructive text-sm" : "text-muted-foreground text-sm"
      }
    >
      <BrandText text={notice.text} />
    </p>
  );

  if (!connection.available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2" tabIndex={-1} ref={headingRef}>
            <BrandText text={copy.unavailableTitle} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p role="note" className="text-muted-foreground flex items-start gap-2 text-sm">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <BrandText text={copy.unavailableBody} />
            </span>
          </p>
        </CardContent>
      </Card>
    );
  }

  const heading = (title: string) => (
    <CardHeader>
      <CardTitle as="h2" tabIndex={-1} ref={headingRef} className="outline-none">
        <BrandText text={title} />
      </CardTitle>
      <StatusBadge status={connection.status} t={t} />
    </CardHeader>
  );

  if (connection.status === "not_connected" || connection.status === "disconnected") {
    return (
      <Card>
        {heading(copy.notConnectedTitle)}
        <CardContent className="flex flex-col gap-4">
          <CardDescription>
            <BrandText text={copy.notConnectedBody} />
          </CardDescription>
          <ul className="text-muted-foreground ms-5 list-disc text-sm">
            <li>
              <BrandText text={copy.needAccount} />
            </li>
            <li>
              <BrandText text={copy.needNumber} />
            </li>
          </ul>
          {connection.signup !== undefined && (
            <EmbeddedSignupButton signup={connection.signup} label={copy.connect} t={t} />
          )}
        </CardContent>
      </Card>
    );
  }

  if (connection.status === "onboarding") {
    const failure = connection.onboardingFailure;
    return (
      <Card>
        {heading(copy.onboardingTitle)}
        <CardContent className="flex flex-col gap-4">
          <CardDescription>
            <BrandText text={copy.onboardingBody} />
          </CardDescription>
          {failure !== null && (
            <p role="alert" className="text-sm">
              <TriangleAlertIcon
                aria-hidden="true"
                className="text-warning-foreground me-2 inline size-4 align-text-bottom"
              />
              <BrandText text={whatsappErrorMessage(failure, t)} />
            </p>
          )}
          {failure === "ONBOARDING_RECONCILIATION_REQUIRED" && (
            <p className="text-muted-foreground text-sm">
              <BrandText text={copy.reconciliationCancelHint} />
            </p>
          )}
          <div className="flex flex-wrap items-start gap-3">
            {connection.signup !== undefined && (
              <EmbeddedSignupButton signup={connection.signup} label={copy.continueSetup} t={t} />
            )}
            <ConfirmDialog
              triggerLabel={copy.cancelSetup}
              title={copy.cancelSetup}
              description={copy.cancelSetupDescription}
              cancelLabel={copy.keepSetup}
              confirmLabel={copy.cancelSetup}
              onConfirm={() => abandonOnboardingAction(connection.version)}
              onResult={report}
              fallbackFocus={headingRef}
              onRetain={() => setRetainedConnection((current) => current ?? liveConnection)}
              onRelease={() => setRetainedConnection(null)}
            />
          </div>
          {noticeLine}
        </CardContent>
      </Card>
    );
  }

  // connected | error
  const quality = qualityBadge(connection.qualityRating, t);
  return (
    <Card>
      {heading(copy.connectionTitle)}
      <CardContent className="flex flex-col gap-4">
        {connection.status === "error" && (
          <p role="alert" className="text-sm">
            <TriangleAlertIcon
              aria-hidden="true"
              className="text-warning-foreground me-2 inline size-4 align-text-bottom"
            />
            <BrandText text={whatsappErrorMessage(connection.lastError, t)} />
          </p>
        )}
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{copy.phoneNumber}</dt>
            <dd className="font-medium">
              <bdi dir="ltr">{connection.displayPhoneNumber ?? "—"}</bdi>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{copy.verifiedName}</dt>
            <dd className="font-medium">
              <bdi dir="auto">{connection.verifiedName ?? "—"}</bdi>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{copy.qualityRating}</dt>
            <dd>
              <Badge variant={quality.variant}>{quality.label}</Badge>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{copy.connectedOn}</dt>
            <dd className="font-medium">{formatDate(connection.connectedAt, locale)}</dd>
          </div>
        </dl>
        <p className="text-muted-foreground text-sm">
          <BrandText text={limitSentence(connection.messagingLimitTier, t, locale)} />
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={refreshing}
            onClick={() =>
              startRefresh(async () => {
                const result = await refreshWhatsAppAction();
                setNotice(
                  result.status === "error"
                    ? { tone: "error", text: result.message }
                    : { tone: "info", text: copy.refreshed },
                );
              })
            }
          >
            {refreshing ? copy.working : copy.refresh}
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-expanded={showTest}
            aria-controls="whatsapp-test-panel"
            onClick={() => setShowTest((open) => !open)}
          >
            {copy.sendTest}
          </Button>
          <ConfirmDialog
            triggerLabel={copy.disconnect}
            title={copy.disconnectTitle}
            description={copy.disconnectDescription}
            cancelLabel={copy.cancel}
            confirmLabel={copy.disconnect}
            onConfirm={() => disconnectWhatsAppAction(connection.version)}
            onResult={report}
            fallbackFocus={headingRef}
            onRetain={() => setRetainedConnection((current) => current ?? liveConnection)}
            onRelease={() => setRetainedConnection(null)}
          />
        </div>
        {noticeLine}

        <section
          hidden={!showTest}
          id="whatsapp-test-panel"
          aria-labelledby="whatsapp-test-title"
          className={`border-border flex-col gap-3 border-t pt-4 ${showTest ? "flex" : "hidden"}`}
        >
          <h3 id="whatsapp-test-title" className="text-base font-semibold">
            {copy.test.title}
          </h3>
          <p className="text-muted-foreground text-sm">{copy.test.description}</p>
          {templates === null ? (
            <p role="note" className="text-muted-foreground text-sm">
              {copy.loadError}
            </p>
          ) : (
            <TestSendForm templates={templates} t={t} />
          )}
        </section>
      </CardContent>
    </Card>
  );
}
