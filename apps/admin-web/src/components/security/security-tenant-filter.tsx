"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Label } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * The one filter every `console/*` route shares (`security-operations-routes.ts:50`) — an
 * optional `tenantRef`, persisted in the URL so it survives navigation between the seven screens
 * (`SecuritySubNav` reads it back onto every link) and a refresh/back-button. Applies on submit
 * rather than per-keystroke: unlike `OrdersToolbar`'s debounced search, a tenant ref is typically
 * pasted in whole, not typed character-by-character against a live filter.
 */
export function SecurityTenantFilter({ t }: { readonly t: Dictionary }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("tenantRef") ?? "");

  const apply = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      params.set("tenantRef", trimmed);
    } else {
      params.delete("tenantRef");
    }
    const query = params.toString();
    router.push(query.length > 0 ? `${pathname}?${query}` : pathname);
  };

  return (
    <form onSubmit={apply} className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="security-tenant-filter" className="text-muted-foreground text-sm">
          {t.securityNav.tenantFilterLabel}
        </Label>
        <Input
          id="security-tenant-filter"
          type="text"
          placeholder={t.securityNav.tenantFilterPlaceholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-56"
        />
      </div>
      <Button type="submit" variant="outline" size="sm">
        {t.securityNav.tenantFilterApply}
      </Button>
    </form>
  );
}
