"use client";

import { useEffect, useId, useRef, useState } from "react";
import { COUNTRY_CODES, PROVINCES, hasProvinces, provinceName } from "@platform/regions";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import { searchDraftCustomersAction } from "@/app/draft-orders/actions";
import type { Locale } from "@/lib/i18n";
import {
  EMPTY_DRAFT_ADDRESS,
  type DraftForm,
  type DraftFormAddress,
} from "@/lib/orders/draft-orders";
import { countryName } from "@/lib/shipping/display";
import type { Dictionary } from "@/messages/en";

const SEARCH_DEBOUNCE_MS = 300;
const SELECT_CLASS =
  "border-input bg-card focus-visible:ring-ring h-10 w-full rounded-xl border px-3 text-base focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60";

type CustomerHit = { readonly id: string; readonly name: string; readonly email: string };

/**
 * Shopify's Customer card (spec §4.9): find an existing customer, or fill in a guest's email and
 * phone; the shipping address (a governorate list for countries that have one) and the billing
 * address, "Same as shipping" by default. Identity resolves a guest by email when the order is made.
 */
export function DraftCustomerCard({
  form,
  onChange,
  errors,
  editable,
  t,
  locale,
}: {
  readonly form: DraftForm;
  readonly onChange: (next: Partial<DraftForm>) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly editable: boolean;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const c = t.draftOrders.editor.customer;
  const id = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly CustomerHit[] | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const current = ++seq.current;
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      searchDraftCustomersAction(q)
        .then((found) => {
          if (current === seq.current) setHits(found);
        })
        .catch(() => {
          if (current === seq.current) setHits([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const choose = (hit: CustomerHit) => {
    onChange({
      customer: { id: hit.id, name: hit.name, email: hit.email },
      ...(form.email.trim() === "" ? { email: hit.email } : {}),
    });
    setQuery("");
    setHits(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{c.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {form.customer !== null ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p dir="auto" className="truncate font-medium">
                {form.customer.name ?? form.customer.email ?? c.guest}
              </p>
              {form.customer.email !== null && (
                <p dir="ltr" className="text-muted-foreground truncate text-start text-sm">
                  {form.customer.email}
                </p>
              )}
            </div>
            {editable && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange({ customer: null })}
              >
                {c.remove}
              </Button>
            )}
          </div>
        ) : (
          editable && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-search`} className="sr-only">
                {c.search}
              </Label>
              <Input
                id={`${id}-search`}
                type="search"
                dir="auto"
                maxLength={100}
                value={query}
                placeholder={c.search}
                onChange={(event) => setQuery(event.target.value)}
              />
              {hits?.length === 0 && <p className="text-muted-foreground text-sm">{c.noResults}</p>}
              {hits !== null && hits.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {hits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => choose(hit)}
                        className="hover:bg-accent focus-visible:ring-ring flex w-full flex-col rounded-lg p-2 text-start focus-visible:outline-none focus-visible:ring-2"
                      >
                        <span dir="auto" className="font-medium">
                          {hit.name}
                        </span>
                        <span dir="ltr" className="text-muted-foreground text-start text-sm">
                          {hit.email}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        )}
        {errors["customerId"] !== undefined && (
          <p role="alert" className="text-destructive text-sm">
            {errors["customerId"]}
          </p>
        )}

        <Field
          id={`${id}-email`}
          label={c.email}
          type="email"
          dir="ltr"
          maxLength={254}
          value={form.email}
          editable={editable}
          error={errors["email"]}
          onChange={(email) => onChange({ email })}
        />
        <Field
          id={`${id}-phone`}
          label={c.phone}
          type="tel"
          dir="ltr"
          maxLength={32}
          value={form.phone}
          editable={editable}
          error={errors["phone"]}
          onChange={(phone) => onChange({ phone })}
        />

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{c.shippingAddress}</h3>
          {form.shippingAddress === null ? (
            editable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => onChange({ shippingAddress: EMPTY_DRAFT_ADDRESS })}
              >
                {c.addAddress}
              </Button>
            )
          ) : (
            <>
              <AddressFields
                prefix="shippingAddress"
                address={form.shippingAddress}
                onChange={(shippingAddress) => onChange({ shippingAddress })}
                errors={errors}
                editable={editable}
                t={t}
                locale={locale}
              />
              {editable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => onChange({ shippingAddress: null })}
                >
                  {c.removeAddress}
                </Button>
              )}
            </>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{c.billingAddress}</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.billingSame}
              disabled={!editable}
              onChange={(event) =>
                onChange({
                  billingSame: event.target.checked,
                  ...(event.target.checked || form.billingAddress !== null
                    ? {}
                    : { billingAddress: form.shippingAddress ?? EMPTY_DRAFT_ADDRESS }),
                })
              }
            />
            {c.sameAsShipping}
          </label>
          {!form.billingSame && (
            <AddressFields
              prefix="billingAddress"
              address={form.billingAddress ?? EMPTY_DRAFT_ADDRESS}
              onChange={(billingAddress) => onChange({ billingAddress })}
              errors={errors}
              editable={editable}
              t={t}
              locale={locale}
            />
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  editable,
  error,
  type = "text",
  dir = "auto",
  maxLength,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly editable: boolean;
  readonly error?: string | undefined;
  readonly type?: "text" | "email" | "tel";
  readonly dir?: "auto" | "ltr";
  readonly maxLength: number;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        dir={dir}
        maxLength={maxLength}
        value={value}
        readOnly={!editable}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => onChange(event.target.value)}
      />
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

function AddressFields({
  prefix,
  address,
  onChange,
  errors,
  editable,
  t,
  locale,
}: {
  readonly prefix: "shippingAddress" | "billingAddress";
  readonly address: DraftFormAddress;
  readonly onChange: (address: DraftFormAddress) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly editable: boolean;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const a = t.draftOrders.editor.customer.address;
  const id = useId();
  const set = (patch: Partial<DraftFormAddress>) => onChange({ ...address, ...patch });
  const err = (field: keyof DraftFormAddress) => errors[`${prefix}.${field}`];
  const text = (
    field: "name" | "phone" | "line1" | "line2" | "city" | "postalCode",
    maxLength: number,
    options: { readonly type?: "tel"; readonly dir?: "ltr" } = {},
  ) => (
    <Field
      id={`${id}-${field}`}
      label={a[field]}
      type={options.type ?? "text"}
      dir={options.dir ?? "auto"}
      maxLength={maxLength}
      value={address[field]}
      editable={editable}
      error={err(field)}
      onChange={(value) => set({ [field]: value })}
    />
  );
  const provinces = hasProvinces(address.country) ? (PROVINCES[address.country] ?? []) : [];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {text("name", 120)}
      {text("phone", 32, { type: "tel", dir: "ltr" })}
      <div className="sm:col-span-2">{text("line1", 200)}</div>
      <div className="sm:col-span-2">{text("line2", 200)}</div>
      {text("city", 100)}
      {provinces.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-province`}>{a.province}</Label>
          <select
            id={`${id}-province`}
            className={SELECT_CLASS}
            value={address.province}
            disabled={!editable}
            onChange={(event) => set({ province: event.target.value })}
          >
            <option value="">{a.selectProvince}</option>
            {provinces.map((province) => (
              <option key={province.code} value={province.code}>
                {provinceName(province.code, locale)}
              </option>
            ))}
          </select>
          {err("province") !== undefined && (
            <p role="alert" className="text-destructive text-sm">
              {err("province")}
            </p>
          )}
        </div>
      )}
      {text("postalCode", 20, { dir: "ltr" })}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-country`}>{a.country}</Label>
        <select
          id={`${id}-country`}
          className={SELECT_CLASS}
          value={address.country}
          disabled={!editable}
          onChange={(event) => set({ country: event.target.value, province: "" })}
        >
          {COUNTRY_CODES.map((code) => (
            <option key={code} value={code}>
              {countryName(code, locale)}
            </option>
          ))}
        </select>
        {err("country") !== undefined && (
          <p role="alert" className="text-destructive text-sm">
            {err("country")}
          </p>
        )}
      </div>
    </div>
  );
}
