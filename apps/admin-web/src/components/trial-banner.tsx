import Link from "next/link";
import { cn } from "@platform/ui";
import type { Locale } from "@/lib/i18n";
import { dayCountPhrase } from "@/lib/day-count";
import { formatNumber } from "@/lib/format";
import type { Dictionary } from "@/messages/en";

interface TrialBannerProps {
  /** From `getStoreContext()`; `null` means nothing to say. */
  readonly banner: "trial-ending" | "past-due" | null;
  readonly trialDaysLeft: number | null;
  readonly t: Dictionary;
  readonly locale: Locale;
}

/**
 * The notice above the content area: the free trial is about to end (a prompt to choose a plan),
 * or the payment is overdue (destructive). Both lead to Settings → Plan and billing. A server
 * component — a link needs no client JS.
 */
export function TrialBanner({ banner, trialDaysLeft, t, locale }: TrialBannerProps) {
  if (banner === null) return null;

  let text: string;
  if (banner === "past-due") {
    text = t.trialBanner.pastDue;
  } else {
    if (trialDaysLeft === null) return null;
    const days = dayCountPhrase(t.dayCount, trialDaysLeft, formatNumber(locale, trialDaysLeft));
    text = t.trialBanner.trialEnding.replace("{days}", days);
  }

  const pastDue = banner === "past-due";
  return (
    <div
      role={pastDue ? "alert" : "status"}
      className={cn(
        "px-4 py-2.5 text-center text-sm sm:px-6",
        pastDue
          ? "bg-destructive-subtle text-destructive-subtle-foreground"
          : "bg-warning-subtle text-warning-foreground",
      )}
    >
      <Link href="/settings/billing" className="font-medium underline-offset-4 hover:underline">
        {text}
      </Link>
    </div>
  );
}
