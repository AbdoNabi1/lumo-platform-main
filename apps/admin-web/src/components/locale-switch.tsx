"use client";

import * as React from "react";
import { LanguagesIcon } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@platform/ui";
import { setLocale } from "@/app/actions";
import { LOCALES, type Locale } from "@/lib/i18n";

const NATIVE_NAME: Readonly<Record<Locale, string>> = {
  en: "English",
  ar: "العربية",
};

/**
 * Language switch. Each option is written in its own language — never translated into the
 * currently active one, which is what makes a switcher usable to someone who cannot read
 * the current UI.
 */
export function LocaleSwitch({
  locale,
  label,
}: {
  readonly locale: Locale;
  readonly label: string;
}) {
  const [pending, startTransition] = React.useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} disabled={pending}>
          <LanguagesIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {LOCALES.map((candidate) => (
          <DropdownMenuItem
            key={candidate}
            lang={candidate}
            aria-current={candidate === locale ? "true" : undefined}
            className={candidate === locale ? "text-primary-subtle-foreground" : undefined}
            onSelect={() => {
              startTransition(async () => {
                await setLocale(candidate);
              });
            }}
          >
            {NATIVE_NAME[candidate]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
