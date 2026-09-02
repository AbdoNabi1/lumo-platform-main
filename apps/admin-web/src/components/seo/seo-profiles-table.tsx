import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { SeoProfileDto } from "@/lib/api/seo";
import type { Dictionary } from "@/messages/en";

export function SeoProfilesTable({
  profiles,
  t,
}: {
  readonly profiles: readonly SeoProfileDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.seoProfilesPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.seoProfilesPage.columns.pageRef}</TableHead>
          <TableHead>{t.seoProfilesPage.columns.title}</TableHead>
          <TableHead>{t.seoProfilesPage.columns.canonicalUrl}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {profiles.map((profile) => (
          <TableRow key={profile.id}>
            <TableCell className="font-medium">
              <Link
                href={`/seo/profiles/${profile.id}`}
                className="hover:text-primary font-mono text-xs"
                aria-label={t.seoProfilesPage.viewProfile.replace("{pageRef}", profile.pageRef)}
              >
                {profile.pageRef}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {profile.title ?? t.seoProfilesPage.none}
            </TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">
              {profile.canonicalUrl ?? t.seoProfilesPage.none}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
