"use client";

import { Fragment, useActionState, useEffect, useId, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import {
  addDomainAction,
  makeDomainPrimaryAction,
  verifyDomainAction,
} from "@/app/settings/domains/actions";
import { Field } from "@/components/products/editor/field";
import type { FormState } from "@/lib/api/mutation";
import { dnsRecordsFor, type DnsTargetDto, type ShopDomainDto } from "@/lib/domains/model";
import type { Dictionary } from "@/messages/en";
import { CopyLinkButton } from "./copy-link-button";

const INITIAL_STATE: FormState = { status: "idle" };

/** Fills `{hostname}` / `{target}` in a dictionary sentence, setting each value in a code span. */
function fillTemplate(template: string, values: Readonly<Record<string, string>>): ReactNode[] {
  return template.split(/(\{[a-z]+\})/).map((part, index) => {
    const value = values[part.slice(1, -1)];
    return part.startsWith("{") && value !== undefined ? (
      <code key={index} className="bg-muted rounded px-1 py-0.5 text-xs" dir="ltr">
        {value}
      </code>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    );
  });
}

/** One row button that posts the domain's id through a server action and shows why it failed. */
function RowAction({
  action,
  domainId,
  label,
  pendingLabel,
  variant = "outline",
}: {
  readonly action: (previous: FormState, formData: FormData) => Promise<FormState>;
  readonly domainId: string;
  readonly label: string;
  readonly pendingLabel: string;
  readonly variant?: "outline" | "ghost";
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="domainId" value={domainId} />
      <Button type="submit" variant={variant} size="sm" loading={isPending}>
        {isPending ? pendingLabel : label}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive max-w-60 text-end text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** The inline "Connect existing domain" form. Closes itself after a successful connect. */
function ConnectForm({ t, onClose }: { readonly t: Dictionary; readonly onClose: () => void }) {
  const copy = t.domainsPage;
  const [state, formAction, isPending] = useActionState(addDomainAction, INITIAL_STATE);
  const errors: Readonly<Record<string, string>> =
    state.status === "error" ? state.fieldErrors : {};
  const hasFieldErrors = Object.keys(errors).length > 0;

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} noValidate className="flex flex-col gap-4">
          <Field
            label={copy.hostname}
            name="hostname"
            hint={copy.hostnameHint}
            error={errors["hostname"]}
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={copy.hostnamePlaceholder}
              />
            )}
          </Field>
          {state.status === "error" && !hasFieldErrors && (
            <p role="alert" className="text-destructive text-sm">
              {state.message}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {copy.cancel}
            </Button>
            <Button type="submit" loading={isPending} disabled={isPending}>
              {isPending ? copy.connecting : copy.connectSubmit}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The DNS record(s) that will make this domain verify — taken from the runtime verifier's own target
 * (a CNAME for a subdomain, A records for an apex, both when the host could be either). With no such
 * target configured it says to contact support rather than show a record that would never verify.
 */
function SetupInstructions({
  domain,
  dnsTarget,
  t,
}: {
  readonly domain: ShopDomainDto;
  readonly dnsTarget: DnsTargetDto;
  readonly t: Dictionary;
}) {
  const copy = t.domainsPage;
  const headingId = useId();
  const records = dnsRecordsFor(domain.hostname, dnsTarget);
  return (
    <section
      aria-labelledby={headingId}
      className="border-border bg-muted/30 flex flex-col gap-1 rounded-md border p-4"
    >
      <h3 id={headingId} className="text-sm font-semibold">
        {copy.setupTitle.replace("{hostname}", domain.hostname)}
      </h3>
      {records.length === 0 ? (
        <p className="text-muted-foreground text-sm">{copy.setupContactSupport}</p>
      ) : (
        <>
          {records.length > 1 && (
            <p className="text-muted-foreground text-sm">{copy.setupEither}</p>
          )}
          {records.map((record) => (
            <p key={record.type} className="text-muted-foreground text-sm">
              {record.type === "CNAME"
                ? fillTemplate(copy.setupCname, {
                    hostname: domain.hostname,
                    target: record.target,
                  })
                : fillTemplate(copy.setupA, {
                    hostname: domain.hostname,
                    target: record.targets.join(", "),
                  })}
            </p>
          ))}
          <p className="text-muted-foreground text-sm">{copy.setupVerify}</p>
        </>
      )}
    </section>
  );
}

/**
 * Settings → Domains (Shopify's Domains page): the store's Morbeh subdomain plus any custom domains,
 * with Verify for a pending one, Make primary for a connected one, and DNS instructions until a custom
 * domain is verified. Reads/writes only through the page's server actions.
 */
export function DomainsView({
  domains,
  dnsTarget,
  t,
}: {
  readonly domains: readonly ShopDomainDto[];
  /** What the runtime's DNS verifier accepts (`GET /store/domains`'s `dnsTarget`). */
  readonly dnsTarget: DnsTargetDto;
  readonly t: Dictionary;
}) {
  const copy = t.domainsPage;
  const [connecting, setConnecting] = useState(false);
  const pending = domains.filter(
    (domain) => domain.kind === "custom" && domain.status === "pending",
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        {!connecting && (
          <Button type="button" onClick={() => setConnecting(true)}>
            {copy.connect}
          </Button>
        )}
      </div>

      {connecting && <ConnectForm t={t} onClose={() => setConnecting(false)} />}

      <Card>
        <CardHeader className="sr-only">
          <CardTitle>{copy.tableLabel}</CardTitle>
        </CardHeader>
        {domains.length === 0 ? (
          <CardContent className="text-muted-foreground p-6 text-sm">{copy.empty}</CardContent>
        ) : (
          <CardContent className="p-0">
            <Table aria-label={copy.tableLabel}>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.columnDomain}</TableHead>
                  <TableHead>{copy.columnType}</TableHead>
                  <TableHead>{copy.columnStatus}</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((domain) => (
                  <TableRow key={domain.id}>
                    <TableCell className="font-medium" dir="ltr">
                      {domain.hostname}
                    </TableCell>
                    <TableCell>
                      {domain.kind === "platform" ? copy.typePlatform : copy.typeCustom}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={domain.status === "verified" ? "success" : "warning"}>
                          {domain.status === "verified" ? copy.statusConnected : copy.statusPending}
                        </Badge>
                        {domain.isPrimary && <Badge variant="info">{copy.primary}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start justify-end gap-1">
                        {domain.kind === "platform" && (
                          <CopyLinkButton
                            hostname={domain.hostname}
                            label={copy.copyLink}
                            copiedLabel={copy.copied}
                          />
                        )}
                        {domain.kind === "custom" && domain.status === "pending" && (
                          <RowAction
                            action={verifyDomainAction}
                            domainId={domain.id}
                            label={copy.verify}
                            pendingLabel={copy.verifying}
                          />
                        )}
                        {domain.status === "verified" && !domain.isPrimary && (
                          <RowAction
                            action={makeDomainPrimaryAction}
                            domainId={domain.id}
                            label={copy.makePrimary}
                            pendingLabel={copy.updating}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>

      {pending.map((domain) => (
        <SetupInstructions key={domain.id} domain={domain} dnsTarget={dnsTarget} t={t} />
      ))}
    </div>
  );
}
