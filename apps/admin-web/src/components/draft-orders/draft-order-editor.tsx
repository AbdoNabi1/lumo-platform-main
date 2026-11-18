"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, ChevronDownIcon, MoreHorizontalIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
} from "@platform/ui";
import {
  completeDraftOrderAction,
  deleteDraftOrderAction,
  saveDraftOrderAction,
  sendDraftInvoiceAction,
} from "@/app/draft-orders/actions";
import { DRAFT_BADGE } from "@/components/draft-orders/draft-orders-table";
import { TagInput } from "@/components/orders/tag-input";
import type { DraftOrderDto, DraftPayment } from "@/lib/api/draft-orders";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import {
  formFromDraft,
  inputFromForm,
  sameDraftForm,
  type DraftForm,
} from "@/lib/orders/draft-orders";
import { isolateName } from "@/lib/orders/order-timeline";
import type { Dictionary } from "@/messages/en";
import { DraftCustomerCard } from "./draft-customer-card";
import { DraftPaymentCard, type DraftActivity } from "./draft-payment-card";
import { DraftProductsCard } from "./draft-products-card";
import { SendInvoiceDialog } from "./send-invoice-dialog";

/** The order exists but a later step did not finish: the same payment action resumes it. */
const RETRY_CODES = new Set(["PAYMENT_NOT_RECORDED", "ORDER_NOT_UPDATED"]);
/** The draft changed under the merchant: reload it before anything is confirmed again. */
const RELOAD_CODES = new Set(["DRAFT_BUSY", "DRAFT_COMPLETED", "ALREADY_COMPLETED"]);

/**
 * Shopify's draft order page (spec §4.9): Products and Payment on the left; Notes, Customer and Tags on
 * the right; a save bar while there are unsaved changes. The browser holds only ids, quantities and the
 * merchant's own terms — the server prices every line on save (Ruling 12). Send invoice and Collect
 * payment save first (Ruling 15); Save, Send invoice and Collect payment run one at a time. Client
 * component: it imports server ACTIONS and only TYPES from `lib/api`.
 */
export function DraftOrderEditor({
  draft: initial,
  canEdit,
  canMarkPaid,
  t,
  locale,
}: {
  readonly draft: DraftOrderDto | null;
  readonly canEdit: boolean;
  readonly canMarkPaid: boolean;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const e = t.draftOrders.editor;
  const router = useRouter();
  const [saved, setSaved] = useState<DraftOrderDto | null>(initial);
  const [form, setForm] = useState<DraftForm>(() => formFromDraft(initial));
  const [fields, setFields] = useState<Readonly<Record<string, string>>>({});
  const [error, setError] = useState<{
    readonly message: string;
    readonly code: string | null;
  } | null>(null);
  /** The payment to repeat after the order was created but a later step did not finish. */
  const [retry, setRetry] = useState<DraftPayment | null>(null);
  const [pending, startTransition] = useTransition();
  const [activity, setActivity] = useState<DraftActivity>(null);
  const [invoice, setInvoice] = useState<{
    readonly url: string;
    readonly shopName: string;
  } | null>(null);
  const busy = useRef(false);
  const saving = useRef<Promise<DraftOrderDto | null> | null>(null);
  const reloadRequested = useRef(false);
  const latest = useRef({ saved, form });
  useEffect(() => {
    latest.current = { saved, form };
  });

  const completed = saved?.status === "completed";
  const editable = canEdit && !completed;
  const base = useMemo(() => formFromDraft(saved), [saved]);
  const dirty = editable && !sameDraftForm(form, base);
  const update = (next: Partial<DraftForm>) => setForm((current) => ({ ...current, ...next }));

  // A newer draft from the server (a refresh after an action, or Reload) replaces what is shown —
  // never the merchant's unsaved edits, unless they asked to reload.
  useEffect(() => {
    if (initial === null) return;
    const { saved: current, form: editing } = latest.current;
    const force = reloadRequested.current;
    // Only a NEWER draft (M-3): a stale payload (a refresh racing a save) never replaces a newer one.
    const newer =
      current === null ||
      initial.version > current.version ||
      (initial.version === current.version && initial.status !== current.status);
    if (!force && !newer) return;
    const untouched = current === null || sameDraftForm(editing, formFromDraft(current));
    if (!force && !untouched) return;
    reloadRequested.current = false;
    setSaved(initial);
    setForm(formFromDraft(initial));
    setFields({});
  }, [initial]);

  /**
   * Fetches the server's draft. On `/new` the page itself has no draft to refresh, so a draft created
   * here opens its own page instead (M-2) — no one-time link is on screen on these paths.
   */
  const refreshDraft = (draftId: string | null) => {
    if (initial === null && draftId !== null) router.replace(`/draft-orders/${draftId}`);
    else router.refresh();
  };
  const reload = () => {
    reloadRequested.current = true;
    setError(null);
    refreshDraft(latest.current.saved?.id ?? null);
  };

  /**
   * Saves when there is something to save; answers the saved draft or null (and shows why). One save
   * at a time: a second call while one runs shares it.
   */
  function persist(): Promise<DraftOrderDto | null> {
    if (saving.current !== null) return saving.current;
    if (saved !== null && !dirty) return Promise.resolve(saved);
    const submitted = form;
    const run = (async () => {
      const result = await saveDraftOrderAction(
        saved?.id ?? null,
        saved?.version ?? null,
        inputFromForm(submitted, e.discountDialog.defaultReason, e.shippingDialog.free),
      );
      if (!result.ok) {
        setError({ message: result.message, code: result.code });
        setFields(result.fields);
        if (result.code === "DRAFT_COMPLETED") reload();
        return null;
      }
      setError(null);
      setFields({});
      setSaved(result.draft);
      // M-5: what was typed while the save ran is kept (and stays unsaved), never overwritten.
      setForm((current) =>
        sameDraftForm(current, submitted) ? formFromDraft(result.draft) : current,
      );
      return result.draft;
    })().finally(() => {
      saving.current = null;
    });
    saving.current = run;
    return run;
  }

  /** One action at a time: a second press while one runs is ignored. */
  function run(kind: Exclude<DraftActivity, null>, work: () => Promise<void>): void {
    if (busy.current) return;
    busy.current = true;
    setActivity(kind);
    startTransition(async () => {
      try {
        await work();
      } catch {
        setError({ message: e.errors.generic, code: null });
      } finally {
        busy.current = false;
        setActivity(null);
      }
    });
  }

  /** A brand-new draft gets its own address once nothing on this page still needs it. */
  const goToSaved = (draft: DraftOrderDto) => {
    if (initial === null) router.replace(`/draft-orders/${draft.id}`);
  };

  const save = () =>
    run("save", async () => {
      const current = await persist();
      if (current !== null) goToSaved(current);
    });
  const discard = () => {
    setForm(base);
    setFields({});
    setError(null);
  };
  const sendInvoice = () =>
    run("invoice", async () => {
      const current = await persist();
      if (current === null) return;
      const sent = await sendDraftInvoiceAction(current.id);
      if (!sent.ok) {
        setError({ message: sent.message, code: sent.code });
        if (sent.code !== null && RELOAD_CODES.has(sent.code)) reload();
        return;
      }
      setInvoice({ url: sent.url, shopName: sent.shopName });
    });
  const complete = async (draftId: string, payment: DraftPayment) => {
    setRetry(null);
    const done = await completeDraftOrderAction(draftId, payment);
    if (done.ok) {
      router.push(`/orders/${encodeURIComponent(done.orderId)}`);
      return;
    }
    setError({ message: done.message, code: done.code });
    if (done.code !== null && RETRY_CODES.has(done.code)) {
      setRetry(payment);
      refreshDraft(draftId);
    } else if (done.code !== null && RELOAD_CODES.has(done.code)) {
      reload();
    }
  };
  /** "Create the order and record that you received EGP 455.00?" for this draft's own total. */
  const confirmPayment = (payment: DraftPayment, draft: DraftOrderDto) => {
    const total = formatCurrency(locale, draft.totals.totalMinor, draft.currency);
    return window.confirm(
      (payment === "paid" ? e.payment.confirmMarkAsPaid : e.payment.confirmCollect).replace(
        "{total}",
        () => total,
      ),
    );
  };
  // Pre-flight 11: the amount confirmed is the one the save just produced, never an older one.
  const collect = (payment: DraftPayment) =>
    run("complete", async () => {
      const current = await persist();
      if (current === null || !confirmPayment(payment, current)) return;
      await complete(current.id, payment);
    });
  /**
   * I-1: a completed draft whose payment step never finished (a lost "Try again", another staff
   * member, a closed tab). Nothing is saved; the route resumes the order it already placed —
   * idempotently, never a second order — or answers ALREADY_COMPLETED for the other method.
   */
  const recordAgain = (payment: DraftPayment) =>
    run("complete", async () => {
      if (saved === null) return;
      const total = formatCurrency(locale, saved.totals.totalMinor, saved.currency);
      if (!window.confirm(e.confirmRecordAgain.replace("{total}", () => total))) return;
      await complete(saved.id, payment);
    });
  // The merchant already confirmed this payment; a retry is a new submit with a new key.
  const retryCompletion = () =>
    run("complete", async () => {
      if (saved === null || retry === null) return;
      await complete(saved.id, retry);
    });
  const remove = () =>
    run("save", async () => {
      if (
        saved === null ||
        !window.confirm(
          e.confirmDelete.replace("{draft}", () => isolateName(`#${saved.draftNumber}`)),
        )
      )
        return;
      const result = await deleteDraftOrderAction(saved.id);
      if (result.ok) router.push("/draft-orders");
      else setError({ message: result.message, code: result.code });
    });
  /** Rates need lines and an address: without them nothing is saved — no empty draft (M-9). */
  const saveForRates = () =>
    form.lines.length === 0 || form.shippingAddress === null ? Promise.resolve(null) : persist();

  // M-6: only "#D3" is isolated left-to-right; the Arabic "إنشاء طلب" keeps the page's direction.
  const title = saved === null ? e.newTitle : <bdi dir="ltr">{`#${saved.draftNumber}`}</bdi>;
  const orderNumber = saved?.order?.orderNumber ?? null;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="-ms-2">
          <Link href="/draft-orders">
            <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
            {e.back}
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {saved !== null && (
          <Badge variant={DRAFT_BADGE[saved.status]}>{t.draftOrders.status[saved.status]}</Badge>
        )}
        {editable && saved !== null && (
          <div className="ms-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={pending}>
                  <MoreHorizontalIcon aria-hidden="true" />
                  {e.moreActions}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={remove} className="text-destructive">
                  {e.deleteDraft}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {completed && saved?.order != null && (
        <div className="bg-success-subtle text-success-foreground flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm">
          <p role="status" className="me-auto">
            {e.completedBanner}
          </p>
          <Button asChild size="sm">
            <Link href={`/orders/${encodeURIComponent(saved.order.id)}`}>
              {e.viewOrder.replace("{number}", () =>
                orderNumber === null ? "" : isolateName(`#${orderNumber}`),
              )}
            </Link>
          </Button>
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="outline" disabled={pending}>
                  {e.recordPaymentAgain}
                  <ChevronDownIcon aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!canMarkPaid} onSelect={() => recordAgain("paid")}>
                  {e.payment.markAsPaid}
                </DropdownMenuItem>
                {!canMarkPaid && (
                  <p className="text-muted-foreground px-2 pb-1 text-xs">
                    {e.payment.markAsPaidAdminOnly}
                  </p>
                )}
                <DropdownMenuItem onSelect={() => recordAgain("collect_on_delivery")}>
                  {e.payment.collectOnDelivery}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {dirty && (
        <div className="bg-background/95 sticky top-16 z-20 flex flex-wrap items-center justify-end gap-3 py-2 backdrop-blur">
          <span className="text-muted-foreground me-auto text-sm">{e.unsaved}</span>
          <Button type="button" variant="outline" onClick={discard} disabled={pending}>
            {e.discard}
          </Button>
          <Button type="button" onClick={save} loading={activity === "save"} disabled={pending}>
            {activity === "save" ? e.saving : e.save}
          </Button>
        </div>
      )}
      {error !== null && (
        <div role="alert" className="text-destructive flex flex-wrap items-center gap-3 text-sm">
          <p>{error.message}</p>
          {retry !== null && canEdit && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={retryCompletion}
              disabled={pending}
            >
              {e.retry}
            </Button>
          )}
          {error.code === "VERSION_CONFLICT" && (
            <Button type="button" size="sm" variant="outline" onClick={reload} disabled={pending}>
              {e.reload}
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <DraftProductsCard
            lines={form.lines}
            onChange={(lines) => update({ lines })}
            errors={fields}
            editable={editable}
            currency={saved?.currency ?? null}
            t={t}
            locale={locale}
          />
          <DraftPaymentCard
            draft={saved}
            form={form}
            dirty={dirty}
            editable={editable}
            canMarkPaid={canMarkPaid}
            pending={pending}
            activity={activity}
            onDiscount={(discount) => update({ discount })}
            onShipping={(shipping) => update({ shipping })}
            saveFirst={saveForRates}
            onSendInvoice={sendInvoice}
            onCollect={collect}
            errors={fields}
            t={t}
            locale={locale}
          />
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{e.notes.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor="draft-note" className="sr-only">
                {e.notes.label}
              </Label>
              <textarea
                id="draft-note"
                dir="auto"
                rows={3}
                maxLength={5000}
                readOnly={!editable}
                value={form.note}
                placeholder={e.notes.placeholder}
                onChange={(event) => update({ note: event.target.value })}
                className="border-input bg-card focus-visible:ring-ring min-h-20 w-full rounded-xl border px-3.5 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
              />
              {fields["note"] !== undefined && (
                <p role="alert" className="text-destructive text-sm">
                  {fields["note"]}
                </p>
              )}
            </CardContent>
          </Card>
          <DraftCustomerCard
            form={form}
            onChange={update}
            errors={fields}
            editable={editable}
            t={t}
            locale={locale}
          />
          <Card>
            <CardHeader>
              <CardTitle>{e.tags.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <TagInput
                label={e.tags.label}
                tags={form.tags}
                disabled={!editable}
                maxTags={250}
                onAdd={(added) =>
                  setForm((current) => ({
                    ...current,
                    tags: [
                      ...current.tags,
                      ...added.filter(
                        (tag) =>
                          !current.tags.some((have) => have.toLowerCase() === tag.toLowerCase()),
                      ),
                    ],
                  }))
                }
                onRemove={(tag) =>
                  setForm((current) => ({
                    ...current,
                    tags: current.tags.filter((have) => have !== tag),
                  }))
                }
                t={t}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {invoice !== null && saved !== null && (
        <SendInvoiceDialog
          url={invoice.url}
          shopName={invoice.shopName}
          draftNumber={saved.draftNumber}
          total={saved.totals.totalMinor}
          currency={saved.currency}
          form={form}
          onClose={() => {
            // The link is forgotten with the dialog: the next Send invoice mints a new one.
            setInvoice(null);
            goToSaved(saved);
          }}
          t={t}
          locale={locale}
        />
      )}
    </div>
  );
}
