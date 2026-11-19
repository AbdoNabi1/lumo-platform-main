"use client";

import { createContext, useContext, type ReactNode } from "react";

const PreviewModeContext = createContext<{ readonly active: boolean }>({ active: false });
const ACTIVE = { active: true } as const;
const INACTIVE = { active: false } as const;

/** Ruling 15: a preview is view-only; controls that would write read this and disable themselves. */
export function PreviewModeProvider({
  token,
  children,
}: {
  readonly token: string | null;
  readonly children: ReactNode;
}) {
  return (
    <PreviewModeContext.Provider value={token === null ? INACTIVE : ACTIVE}>
      {children}
    </PreviewModeContext.Provider>
  );
}

export function usePreviewMode(): { readonly active: boolean } {
  return useContext(PreviewModeContext);
}
