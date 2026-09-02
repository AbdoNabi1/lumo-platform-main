"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Label } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * Feature-key search for the Feature Registry explorer (T3.4) — drives `?key=` in the URL (same
 * apply-on-submit pattern as `SecurityTenantFilter`, not a per-keystroke live filter: a feature
 * key is typically pasted or picked from the table, not typed against a live query). The server
 * page reads `?key=` back and calls `resolveFeature`, so the resolution panel, the URL, and the
 * back button all stay in sync.
 */
export function FeatureKeySearch({ t }: { readonly t: Dictionary }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("key") ?? "");

  const apply = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      params.set("key", trimmed);
    } else {
      params.delete("key");
    }
    const query = params.toString();
    router.push(query.length > 0 ? `${pathname}?${query}` : pathname);
  };

  return (
    <form onSubmit={apply} className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="feature-key-search" className="text-muted-foreground text-sm">
          {t.featureRegistryPage.searchLabel}
        </Label>
        <Input
          id="feature-key-search"
          type="text"
          placeholder={t.featureRegistryPage.searchPlaceholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-72"
        />
      </div>
      <Button type="submit" variant="outline" size="sm">
        {t.featureRegistryPage.searchApply}
      </Button>
    </form>
  );
}
