import Link from "next/link";
import { Button } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * Wave 2a: the shop only takes orders from signed-in customers (checkout settings, "require login").
 * Shown where a guest was stopped: the cart (checkout could not start), the checkout page, and the
 * "Place order" step (the server answered 403 `LOGIN_REQUIRED`). Both links are plain links to the
 * account pages; the register link is left out when the shop has accounts off (it cannot be, by D37,
 * but a settings read that failed must not offer a page that says no).
 */
export function LoginRequiredNotice({
  t,
  showRegister = true,
}: {
  readonly t: Dictionary;
  readonly showRegister?: boolean;
}) {
  return (
    <div
      role="alert"
      className="border-border bg-muted/40 flex flex-col gap-3 rounded-md border px-4 py-4 text-sm"
    >
      <p className="text-base font-semibold">{t.checkout.loginRequired.title}</p>
      <p className="text-muted-foreground">{t.checkout.loginRequired.body}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/account/login">{t.checkout.loginRequired.signIn}</Link>
        </Button>
        {showRegister && (
          <Button asChild size="sm" variant="outline">
            <Link href="/account/register">{t.checkout.loginRequired.register}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
