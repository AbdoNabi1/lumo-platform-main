import { Card, CardContent, CardHeader, Skeleton } from "@platform/ui";

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="size-9 rounded-md" />
      </div>
      <Card aria-busy="true">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Skeleton className="size-9 rounded-md" />
            <Skeleton className="h-6 w-48" />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-24" />
        </CardContent>
      </Card>
    </main>
  );
}
