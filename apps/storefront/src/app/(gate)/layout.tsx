import type { ReactNode } from "react";

/** Spec 1.12: the gate has the brand (root layout) but not the shop's header and footer. */
export default function GateLayout({ children }: { readonly children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      {children}
    </main>
  );
}
