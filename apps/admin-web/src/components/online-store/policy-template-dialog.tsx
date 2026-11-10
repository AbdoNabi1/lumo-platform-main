"use client";

import { useId, useState, type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
} from "@platform/ui";
import type { PolicyType } from "@platform/storefront-content";
import { generatePolicyTemplateAction } from "@/app/settings/policies/actions";
import type { PolicyTemplateInputsDto } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import { settleAction } from "@/lib/online-store/settle-action";
import type { Dictionary } from "@/messages/en";

type Answers = {
  storeName: string;
  contactEmail: string;
  contactPhone: string;
  businessAddress: string;
  returnWindowDays: string;
  returnShippingPaidBy: PolicyTemplateInputsDto["returnShippingPaidBy"];
  refundMethod: PolicyTemplateInputsDto["refundMethod"];
  cashOnDelivery: boolean;
  deliveryMin: string;
  deliveryMax: string;
  shipsInternationally: boolean;
};

const answersOf = (d: PolicyTemplateInputsDto): Answers => ({
  storeName: d.storeName,
  contactEmail: d.contactEmail,
  contactPhone: d.contactPhone,
  businessAddress: d.businessAddress,
  returnWindowDays: String(d.returnWindowDays),
  returnShippingPaidBy: d.returnShippingPaidBy,
  refundMethod: d.refundMethod,
  cashOnDelivery: d.cashOnDelivery,
  deliveryMin: String(d.deliveryDays.min),
  deliveryMax: String(d.deliveryDays.max),
  shipsInternationally: d.shipsInternationally,
});

/** A whole number written in the field, or null (the API checks the ranges again). */
function wholeNumber(raw: string, min: number, max: number): number | null {
  if (!/^\d{1,3}$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return value >= min && value <= max ? value : null;
}

/** The answers as the API takes them, or null when a day count is not a whole number in range. */
function inputsOf(a: Answers): PolicyTemplateInputsDto | null {
  const returnWindowDays = wholeNumber(a.returnWindowDays, 0, 365);
  const min = wholeNumber(a.deliveryMin, 1, 60);
  const max = min === null ? null : wholeNumber(a.deliveryMax, min, 90);
  if (returnWindowDays === null || min === null || max === null) return null;
  return {
    storeName: a.storeName,
    contactEmail: a.contactEmail,
    contactPhone: a.contactPhone,
    businessAddress: a.businessAddress,
    returnWindowDays,
    returnShippingPaidBy: a.returnShippingPaidBy,
    refundMethod: a.refundMethod,
    cashOnDelivery: a.cashOnDelivery,
    deliveryDays: { min, max },
    shipsInternationally: a.shipsInternationally,
  };
}

/**
 * "Create from template" (spec 2.3): the merchant's answers, prefilled from `defaults` (Ruling
 * 20), and the language to write in. Generate asks the API for the text and hands it to the card
 * (`onGenerated`); nothing is saved here. The reminder that this is not legal advice is shown
 * before generating, and the card shows it again above the editor.
 */
export function PolicyTemplateDialog({
  t,
  locale,
  type,
  defaults,
  open,
  initialLocale,
  onOpenChange,
  onGenerated,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly type: PolicyType;
  readonly defaults: PolicyTemplateInputsDto;
  readonly open: boolean;
  /** The language to generate in at first (the card's open tab); the admin's language otherwise. */
  readonly initialLocale?: "ar" | "en";
  readonly onOpenChange: (open: boolean) => void;
  readonly onGenerated: (locale: "ar" | "en", body: string) => void;
}) {
  const p = t.policies;
  const id = useId();
  const [answers, setAnswers] = useState<Answers>(() => answersOf(defaults));
  const [language, setLanguage] = useState<"ar" | "en">(initialLocale ?? locale);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Answers>(key: K, value: Answers[K]) =>
    setAnswers((before) => ({ ...before, [key]: value }));

  const generate = async () => {
    const inputs = inputsOf(answers);
    if (inputs === null) {
      setError(p.templateInvalid);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await settleAction(
        () => generatePolicyTemplateAction(type, language, inputs),
        { status: "error" as const, message: t.formErrors.unexpected },
      );
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      onGenerated(language, result.body);
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  const field = (key: string, label: string, control: (fieldId: string) => ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      {control(`${id}-${key}`)}
    </div>
  );
  const text = (
    key: "storeName" | "contactEmail" | "contactPhone" | "businessAddress",
    label: string,
    type: "text" | "email" | "tel" = "text",
  ) =>
    field(key, label, (fieldId) => (
      <Input
        id={fieldId}
        type={type}
        dir="auto"
        value={answers[key]}
        onChange={(event) => set(key, event.currentTarget.value)}
      />
    ));
  const days = (
    key: "returnWindowDays" | "deliveryMin" | "deliveryMax",
    label: string,
    min: number,
    max: number,
  ) =>
    field(key, label, (fieldId) => (
      <Input
        id={fieldId}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={answers[key]}
        onChange={(event) => set(key, event.currentTarget.value)}
      />
    ));
  const check = (key: "cashOnDelivery" | "shipsInternationally", label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="accent-primary size-4"
        checked={answers[key]}
        onChange={(event) => set(key, event.currentTarget.checked)}
      />
      {label}
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{p.createFromTemplate}</DialogTitle>
          <DialogDescription>{p.templateHint}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <p
            role="note"
            className="bg-warning-subtle text-warning-foreground rounded-xl px-3 py-2 text-sm"
          >
            {p.reminder}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("storeName", p.storeName)}
            {text("contactEmail", p.email, "email")}
            {text("contactPhone", p.phone, "tel")}
            {text("businessAddress", p.address)}
            {days("returnWindowDays", p.returnWindow, 0, 365)}
            {field("returnShippingPaidBy", p.returnShipping, (fieldId) => (
              <NativeSelect
                id={fieldId}
                value={answers.returnShippingPaidBy}
                onChange={(event) =>
                  set(
                    "returnShippingPaidBy",
                    event.currentTarget.value === "store" ? "store" : "customer",
                  )
                }
              >
                <option value="customer">{p.returnShippingCustomer}</option>
                <option value="store">{p.returnShippingStore}</option>
              </NativeSelect>
            ))}
            {field("refundMethod", p.refundMethod, (fieldId) => (
              <NativeSelect
                id={fieldId}
                value={answers.refundMethod}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  set(
                    "refundMethod",
                    value === "store_credit" || value === "cash" ? value : "original",
                  );
                }}
              >
                <option value="original">{p.refundOriginal}</option>
                <option value="store_credit">{p.refundStoreCredit}</option>
                <option value="cash">{p.refundCash}</option>
              </NativeSelect>
            ))}
            {days("deliveryMin", p.deliveryMin, 1, 60)}
            {days("deliveryMax", p.deliveryMax, 1, 90)}
          </div>
          <div className="flex flex-col gap-2">
            {check("cashOnDelivery", p.cod)}
            {check("shipsInternationally", p.international)}
          </div>
          {field("language", p.templateLocale, (fieldId) => (
            <NativeSelect
              id={fieldId}
              value={language}
              onChange={(event) => setLanguage(event.currentTarget.value === "ar" ? "ar" : "en")}
            >
              <option value="ar">{t.onlineStorePreferences.arabic}</option>
              <option value="en">{t.onlineStorePreferences.english}</option>
            </NativeSelect>
          ))}
          {error === null ? null : (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {p.cancel}
            </Button>
            <Button type="submit" loading={pending} disabled={pending}>
              {pending ? p.generating : p.generate}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
