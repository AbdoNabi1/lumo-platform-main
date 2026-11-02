import { Card, CardContent, CardHeader, Skeleton } from "@platform/ui";

export default function Loading() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <Card aria-busy="true">
        <CardHeader>
          <Skeleton className="h-6 w-24" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    </main>
  );
}
