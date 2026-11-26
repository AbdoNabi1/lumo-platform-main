"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import {
  startSenderDomainAction,
  verifySenderDomainAction,
} from "@/app/settings/notifications/actions";
import {
  domainStatusTone,
  type DnsRecordDto,
  type DomainStatus,
  type SenderDomainActionResult,
  type SenderDomainDto,
} from "@/lib/notification-settings-model";
import type { Dictionary } from "@/messages/en";
import { BdiText, fillText } from "./bdi-text";

function statusLabel(status: DomainStatus, t: Dictionary): string {
  const copy = t.notificationSettings;
  switch (status) {
    case "not_started":
      return copy.statusNotStarted;
    case "pending":
      return copy.statusPending;
    case "verified":
      return copy.statusVerified;
    case "failed":
      return copy.statusFailed;
    case "temporary_failure":
      return copy.statusTemporaryFailure;
  }
}

function CopyButton({
  value,
  label,
  t,
}: {
  readonly value: string;
  readonly label: string;
  readonly t: Dictionary;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      onClick={() => {
        void Promise.resolve(navigator.clipboard?.writeText(value))
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      {copied ? t.notificationSettings.copied : t.notificationSettings.copy}
    </Button>
  );
}

function RecordsTable({
  domain,
  records,
  t,
}: {
  readonly domain: string;
  readonly records: readonly DnsRecordDto[];
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings;
  const showPriority = records.some((record) => record.priority !== null);
  return (
    <Table aria-label={fillText(copy.domainRecordsCaption, { domain })}>
      <TableCaption className="sr-only">
        {fillText(copy.domainRecordsCaption, { domain })}
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{copy.colType}</TableHead>
          <TableHead scope="col">{copy.colName}</TableHead>
          <TableHead scope="col">{copy.colValue}</TableHead>
          {showPriority && <TableHead scope="col">{copy.colPriority}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map((record, index) => {
          const names = { type: record.type, name: record.name };
          return (
            <TableRow key={`${record.type}-${record.name}-${index}`}>
              <TableCell className="font-medium">{record.type}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <bdi dir="ltr" className="break-all">
                    {record.name}
                  </bdi>
                  <CopyButton value={record.name} label={fillText(copy.copyName, names)} t={t} />
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <bdi dir="ltr" className="max-w-xs break-all">
                    {record.value}
                  </bdi>
                  <CopyButton value={record.value} label={fillText(copy.copyValue, names)} t={t} />
                </div>
              </TableCell>
              {showPriority && (
                <TableCell>{record.priority === null ? "" : record.priority}</TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * Authenticate your domain (D43). "Authenticate domain" registers the sender email's domain and
 * shows the DNS records to add; "Verify" asks the provider to check them. Without a provider key on
 * the server this says "not available yet" and nothing else changes: replies still reach the store.
 */
export function SenderDomainCard({
  senderDomain,
  t,
}: {
  readonly senderDomain: SenderDomainDto | null;
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings;
  const [state, setState] = useState<SenderDomainDto | null>(senderDomain);
  const [seen, setSeen] = useState(senderDomain);
  const [busy, setBusy] = useState<"start" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // A newer read from the server (someone saved the sender email; a reload) replaces what is shown.
  if (senderDomain !== seen) {
    setSeen(senderDomain);
    setState(senderDomain);
  }

  const run = async (kind: "start" | "verify") => {
    setBusy(kind);
    setError(null);
    let result: SenderDomainActionResult;
    try {
      result = await (kind === "start" ? startSenderDomainAction() : verifySenderDomainAction());
    } catch {
      result = { status: "error", message: t.formErrors.unexpected };
    }
    setBusy(null);
    if (result.status === "success") setState(result.domain);
    else if (result.status === "unavailable") setUnavailable(true);
    else setError(result.message);
  };

  const row = state?.domain ?? null;
  const suggestion = state?.suggestion ?? null;
  const available = state !== null && state.available && !unavailable;
  const canStart =
    available &&
    suggestion !== null &&
    !suggestion.freeMail &&
    (row === null || (!row.verified && row.domain !== suggestion.domain));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.domainTitle}</CardTitle>
        <p className="text-muted-foreground text-sm">{copy.domainHint}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state === null && <p className="text-muted-foreground text-sm">{copy.loadError}</p>}

        {state !== null && !available && row === null && (
          <p role="note" className="text-muted-foreground text-sm">
            {copy.domainNotAvailable}
          </p>
        )}

        {state !== null && available && row === null && suggestion === null && (
          <p className="text-muted-foreground text-sm">{copy.domainNeedsEmail}</p>
        )}

        {state !== null && available && row === null && suggestion?.freeMail === true && (
          <p className="text-muted-foreground text-sm">
            <BdiText template={copy.domainFreeMail} values={{ domain: suggestion.domain }} />
          </p>
        )}

        {row !== null && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <bdi dir="auto" className="font-medium">
                {row.domain}
              </bdi>
              <Badge variant={domainStatusTone(row.status)}>{statusLabel(row.status, t)}</Badge>
            </div>
            {row.verified ? (
              <p role="status" className="text-sm">
                <BdiText template={copy.domainVerifiedNote} values={{ domain: row.domain }} />
              </p>
            ) : (
              <>
                <h3 className="text-sm font-medium">{copy.domainRecordsTitle}</h3>
                <p className="text-muted-foreground text-sm">
                  <BdiText template={copy.domainRecordsHint} values={{ domain: row.domain }} />
                </p>
                <RecordsTable domain={row.domain} records={row.records} t={t} />
                <p className="text-muted-foreground text-sm">{copy.domainNotVerifiedNote}</p>
              </>
            )}
          </div>
        )}

        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        {state !== null && unavailable && row !== null && (
          <p role="note" className="text-muted-foreground text-sm">
            {copy.domainNotAvailable}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          {canStart && suggestion !== null && (
            <>
              <p className="text-muted-foreground me-auto text-sm">
                <BdiText template={copy.domainSuggestion} values={{ domain: suggestion.domain }} />
              </p>
              <Button
                type="button"
                variant={row === null ? "primary" : "outline"}
                loading={busy === "start"}
                disabled={busy !== null}
                onClick={() => void run("start")}
              >
                {busy === "start" ? copy.domainAuthenticating : copy.domainAuthenticate}
              </Button>
            </>
          )}
          {row !== null && !row.verified && available && (
            <Button
              type="button"
              loading={busy === "verify"}
              disabled={busy !== null}
              onClick={() => void run("verify")}
            >
              {busy === "verify" ? copy.domainVerifying : copy.domainVerify}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
