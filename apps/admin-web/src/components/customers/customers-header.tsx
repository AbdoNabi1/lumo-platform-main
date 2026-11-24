"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Button } from "@platform/ui";
import type { Dictionary } from "@/messages/en";
import { CustomersExportDialog } from "./customers-export-dialog";

/**
 * The Customers list header: title and subtitle, and — for operators and up — "Export" and the
 * primary "Add customer". Viewers and unknown roles get neither (`canEdit`, `canExport`); the API
 * refuses both for them anyway. The export dialog reads the list's current `?q=` from the URL.
 */
export function CustomersHeader({
  canEdit,
  canExport,
  t,
}: {
  readonly canEdit: boolean;
  readonly canExport: boolean;
  readonly t: Dictionary;
}) {
  const searchParams = useSearchParams();
  // The export has no segment parameter yet: under a selected segment it would hand out customers
  // outside it, so it is not offered there (segment-aware export is a follow-up).
  const segmentSelected = (searchParams.get("segment") ?? "") !== "";
  const showExport = canExport && !segmentSelected;

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.customersPage.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.customersPage.subtitle}</p>
      </div>
      {(showExport || canEdit) && (
        <div className="flex flex-wrap items-center gap-2">
          {showExport && <CustomersExportDialog search={searchParams.get("q") ?? ""} t={t} />}
          {canEdit && (
            <Button asChild>
              <Link href="/customers/new">
                <PlusIcon aria-hidden="true" />
                {t.customersPage.addCustomer}
              </Link>
            </Button>
          )}
        </div>
      )}
    </header>
  );
}
