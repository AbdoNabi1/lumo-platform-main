import type { Dictionary } from "@/messages/en";

/**
 * Wave 2a (D37): the shop turned customer accounts off, so sign-in, sign-up and account completion
 * are closed. Guest checkout is untouched, and the notice says so. Shown by the account pages when
 * the shop's settings say accounts are off (or the server answers `ACCOUNTS_DISABLED`).
 */
export function AccountsDisabledNotice({ t }: { readonly t: Dictionary }) {
  return (
    <div role="status" className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{t.account.accountsDisabled.title}</h1>
      <p className="text-muted-foreground text-sm">{t.account.accountsDisabled.body}</p>
    </div>
  );
}
