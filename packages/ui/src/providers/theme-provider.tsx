"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * App-wide theme provider for the Lumo Design System.
 *
 * Puts `.dark` on `<html>` so the dark semantic tokens in `@platform/design/styles.css`
 * take over. Three modes are supported — light, dark, and system — with system as the
 * default, so a first-time visitor gets the theme their OS already asked for.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
