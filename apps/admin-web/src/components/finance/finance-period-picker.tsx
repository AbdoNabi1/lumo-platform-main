"use client";

import { useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Label } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * The period + currency picker for `/finance` (T3.2) — held entirely in the URL
 * (`?startDate=&endDate=&currency=`), mirroring `OrdersToolbar`'s URL-driven filter pattern, so
 * the chosen period is shareable and survives a refresh/back-button. A form with an explicit
 * "Apply" submit (rather than `onChange` pushing immediately like the Orders status filter) since
 * three fields changing together should trigger one re-fetch, not up to three.
 */
export function FinancePeriodPicker({
  t,
  defaultStartDate,
  defaultEndDate,
  defaultCurrency,
}: {
  readonly t: Dictionary;
  readonly defaultStartDate: string;
  readonly defaultEndDate: string;
  readonly defaultCurrency: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [startDate, setStartDate] = useState(searchParams.get("startDate") ?? defaultStartDate);
  const [endDate, setEndDate] = useState(searchParams.get("endDate") ?? defaultEndDate);
  const [currency, setCurrency] = useState(searchParams.get("currency") ?? defaultCurrency);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    params.set("startDate", startDate);
    params.set("endDate", endDate);
    params.set("currency", currency.trim().toUpperCase());
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="finance-start-date">{t.financePage.periodStartLabel}</Label>
        <Input
          id="finance-start-date"
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="finance-end-date">{t.financePage.periodEndLabel}</Label>
        <Input
          id="finance-end-date"
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="finance-currency">{t.financePage.currencyLabel}</Label>
        <Input
          id="finance-currency"
          type="text"
          value={currency}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          maxLength={3}
          className="w-20 uppercase"
          required
        />
      </div>
      <Button type="submit">{t.financePage.apply}</Button>
    </form>
  );
}
