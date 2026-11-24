import type { ReactNode } from "react";
import type { Dictionary } from "@/messages/en";
import { SettingsNav } from "./settings-nav";

/**
 * The layout every settings page renders inside (within the page's single `AppShell`): the Settings
 * sub-navigation on the start side, the page on the end side, stacked below 1024px with the
 * navigation on top. Logical CSS only, so it mirrors in RTL.
 */
export function SettingsFrame({
  t,
  activeId,
  children,
}: {
  readonly t: Dictionary;
  /** The current settings entry; omit on the landing page, where none is current. */
  readonly activeId?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 lg:flex-row lg:items-start">
      <aside className="w-full lg:w-64 lg:shrink-0">
        <SettingsNav t={t} activeId={activeId} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
