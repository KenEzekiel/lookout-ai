import { Spinner } from "./spinner";
import { Skeleton } from "./skeleton";
import { cn } from "@/lib/utils";

export function LoadingIndicator({ className }: { className?: string }) {
  return <Spinner aria-hidden="true" className={className} />;
}

export function LoadingStatus({ label }: { label: string }) {
  return (
    <output aria-label={label} className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoadingIndicator />
      {label}
    </output>
  );
}

export function LoadingState({
  label,
  layout = "list",
}: {
  label: string;
  layout?: "list" | "cards" | "detail" | "screen";
}) {
  return (
    <div
      className={cn("grid w-full gap-5", layout === "screen" && "mx-auto max-w-3xl py-12 sm:py-16")}
    >
      <LoadingStatus label={label} />
      <div
        aria-hidden="true"
        className={cn(
          "grid gap-4",
          layout === "cards" && "md:grid-cols-2",
          layout === "detail" && "lg:grid-cols-[1.5fr_1fr]",
        )}
      >
        {layout === "detail" ? (
          <>
            <Skeleton className="aspect-video w-full rounded-2xl" />
            <div className="grid content-start gap-5 rounded-2xl bg-card p-6">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="mt-4 h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </>
        ) : (
          Array.from({ length: layout === "cards" ? 2 : 3 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 rounded-xl bg-card p-5 sm:p-6">
              <Skeleton className="size-10 shrink-0 rounded-lg" />
              <div className="grid flex-1 gap-3">
                <Skeleton className="h-4 w-2/3 max-w-60" />
                <Skeleton className="h-3 w-4/5 max-w-80" />
                {layout === "cards" && <Skeleton className="mt-4 h-8 w-24" />}
              </div>
              <Skeleton className="hidden h-7 w-20 sm:block" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function PageLoading() {
  return <LoadingState label="Opening page…" layout="screen" />;
}
