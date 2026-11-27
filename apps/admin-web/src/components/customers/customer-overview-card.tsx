"use client";

import { useActionState, useCallback, useEffect, useId, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DialogFooter,
  Input,
  Label,
  NativeSelect,
} from "@platform/ui";
import { updateCustomerProfileAction } from "@/app/customers/actions";
import type { CustomerDetailDto } from "@/lib/api/customers";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";
import { CustomerEditDialog } from "./customer-edit-dialog";

const INITIAL_STATE: FormState = { status: "idle" };

export type CustomerOverview = Pick<
  CustomerDetailDto,
  "id" | "name" | "email" | "phone" | "language" | "isGuest"
>;

function languageLabel(language: CustomerOverview["language"], t: Dictionary): string {
  if (language === "en") return t.customerForm.languageEnglish;
  if (language === "ar") return t.customerForm.languageArabic;
  return t.customerDetail.overview.notSet;
}

/**
 * The customer's profile: name, email, phone and language. Operators and up get "Edit", which opens
 * a real dialog for name, phone and language; the email is shown read-only with a note (changing it
 * touches uniqueness, verification and signup tokens — a later item). Viewers see no edit control.
 */
export function CustomerOverviewCard({
  customer,
  canEdit,
  t,
}: {
  readonly customer: CustomerOverview;
  readonly canEdit: boolean;
  readonly t: Dictionary;
}) {
  const o = t.customerDetail.overview;
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const rows: readonly { readonly label: string; readonly value: ReactNode }[] = [
    { label: t.customerForm.name, value: <bdi dir="auto">{customer.name}</bdi> },
    { label: t.customerForm.email, value: <bdi dir="auto">{customer.email}</bdi> },
    {
      label: o.phone,
      value:
        customer.phone === null ? (
          <span className="text-muted-foreground">{o.notSet}</span>
        ) : (
          <bdi dir="ltr">{customer.phone}</bdi>
        ),
    },
    { label: o.language, value: languageLabel(customer.language, t) },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{o.title}</CardTitle>
          {customer.isGuest && <Badge variant="neutral">{o.guest}</Badge>}
        </div>
        {canEdit && (
          <CustomerEditDialog
            title={t.customerForm.editTitle}
            description={t.customerForm.editDescription}
            triggerLabel={o.edit}
            open={open}
            onOpenChange={setOpen}
          >
            <ProfileForm customer={customer} t={t} onDone={close} onCancel={close} />
          </CustomerEditDialog>
        )}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words">{row.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/** The dialog's form. Mounted only while the dialog is open, so its action state starts clean each time. */
function ProfileForm({
  customer,
  t,
  onDone,
  onCancel,
}: {
  readonly customer: CustomerOverview;
  readonly t: Dictionary;
  readonly onDone: () => void;
  readonly onCancel: () => void;
}) {
  const k = t.customerForm;
  const formId = useId();
  const [state, formAction, isPending] = useActionState(
    updateCustomerProfileAction.bind(null, customer.id),
    INITIAL_STATE,
  );
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [language, setLanguage] = useState(customer.language ?? "");
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};
  const nameError = fieldErrors["name"];
  const phoneError = fieldErrors["phone"];
  const languageError = fieldErrors["language"];
  const hasFieldError =
    nameError !== undefined || phoneError !== undefined || languageError !== undefined;

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-name`}>{k.name}</Label>
        <Input
          id={`${formId}-name`}
          name="name"
          dir="auto"
          data-autofocus=""
          value={name}
          aria-invalid={nameError !== undefined || undefined}
          aria-describedby={nameError !== undefined ? `${formId}-name-error` : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {nameError !== undefined && (
          <p id={`${formId}-name-error`} className="text-destructive text-sm">
            {nameError}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-email`}>{k.email}</Label>
        <Input
          id={`${formId}-email`}
          dir="ltr"
          className="text-start"
          readOnly
          value={customer.email}
          aria-describedby={`${formId}-email-note`}
        />
        <p id={`${formId}-email-note`} className="text-muted-foreground text-sm">
          {k.emailReadOnly}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-phone`}>{k.phone}</Label>
          <Input
            id={`${formId}-phone`}
            name="phone"
            type="tel"
            dir="ltr"
            className="text-start"
            value={phone}
            aria-invalid={phoneError !== undefined || undefined}
            aria-describedby={phoneError !== undefined ? `${formId}-phone-error` : undefined}
            onChange={(event) => setPhone(event.target.value)}
          />
          {phoneError !== undefined && (
            <p id={`${formId}-phone-error`} className="text-destructive text-sm">
              {phoneError}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-language`}>{k.language}</Label>
          <NativeSelect
            id={`${formId}-language`}
            name="language"
            value={language}
            aria-invalid={languageError !== undefined || undefined}
            aria-describedby={languageError !== undefined ? `${formId}-language-error` : undefined}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="">{k.languageNone}</option>
            <option value="en">{k.languageEnglish}</option>
            <option value="ar">{k.languageArabic}</option>
          </NativeSelect>
          {languageError !== undefined && (
            <p id={`${formId}-language-error`} className="text-destructive text-sm">
              {languageError}
            </p>
          )}
        </div>
      </div>
      {state.status === "error" && !hasFieldError && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {k.cancel}
        </Button>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? k.saving : k.saveChanges}
        </Button>
      </DialogFooter>
    </form>
  );
}
