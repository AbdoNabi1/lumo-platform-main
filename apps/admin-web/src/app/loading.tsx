/**
 * Root loading fallback (Phase A.34 — A.33 P1 #5). Shown for the brief gap between navigation and
 * a page's own render — several pages (`orders/[orderId]`, `products/[productId]`,
 * `customers/[customerId]`) `await` their main resource before returning any JSX at all, which
 * previously had no fallback UI whatsoever during that window. Deliberately minimal and
 * locale-agnostic (no cookie read, no session read) — this must render instantly with zero data
 * dependencies, which is the whole point of a `loading.tsx`.
 */
export default function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-live="polite">
      <div
        className="border-muted border-t-primary size-8 animate-spin rounded-full border-4"
        aria-hidden="true"
      />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
