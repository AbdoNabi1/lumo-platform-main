import * as React from "react";
import { cn } from "../../lib/cn";

/**
 * Lumo Table.
 *
 * `Table` wraps itself in a horizontally scrollable region so wide tables never push the
 * page sideways on small screens — the responsive contract for tables. The scroll
 * container is focusable and labelled so keyboard and screen-reader users can reach and
 * understand it (WCAG 2.1.1 / 1.3.1).
 *
 * Always give the table a `<caption>` or an `aria-label`, and mark row headers with
 * `<TableHead scope="row">` where a row has one.
 */
function Table({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & { containerClassName?: string }) {
  return (
    <div
      className={cn("relative w-full overflow-x-auto", containerClassName)}
      tabIndex={0}
      role="region"
      aria-label={props["aria-label"]}
    >
      <table
        className={cn("w-full caption-bottom border-collapse text-base", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("[&_tr]:border-border/70 [&_tr]:border-b", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot className={cn("border-border bg-muted/60 border-t font-medium", className)} {...props} />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-border/70 duration-(--duration-fast) hover:bg-accent/50 data-[state=selected]:bg-primary-subtle border-b transition-colors ease-out",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, scope = "col", ...props }: React.ComponentProps<"th">) {
  return (
    <th
      scope={scope}
      className={cn(
        "text-muted-foreground h-11 whitespace-nowrap px-4 text-start align-middle text-xs font-medium",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3.5 align-middle", className)} {...props} />;
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption className={cn("text-muted-foreground mt-3 text-sm", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption };
