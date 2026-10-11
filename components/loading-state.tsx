import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type LoadingVariant = "scores" | "table" | "stats" | "draft" | "detail" | "list"

function TableRows({ rows = 8 }: { rows?: number }) {
  return (
    <div className="w-full overflow-hidden">
      <div className="flex h-9 items-center gap-3 sm:gap-6 border-b border-border/40">
        <Skeleton className="h-2 w-24" />
        <Skeleton className="ml-auto h-2 w-10" />
        <Skeleton className="h-2 w-10" />
        <Skeleton className="h-2 w-10" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-9 items-center gap-3 sm:gap-6 border-b border-border/20">
          <Skeleton className={cn("h-3 max-w-[40%]", index % 2 ? "w-28" : "w-36")} />
          <Skeleton className="ml-auto h-2 w-10" />
          <Skeleton className="h-2 w-10" />
          <Skeleton className="h-2 w-10" />
        </div>
      ))}
    </div>
  )
}

/** Only use while initial content is absent; never replace data during a refresh. */
export function LoadingState({
  variant = "table",
  label = "Loading…",
  className,
}: {
  variant?: LoadingVariant
  label?: string
  className?: string
}) {
  return (
    <div role="status" aria-label={label} className={cn("w-full min-w-0", className)}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-5">
        {(variant === "stats" || variant === "scores") && (
          <div className="flex h-9 items-center gap-3">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
          </div>
        )}
        {variant === "detail" && (
          <div className="flex items-center gap-4 py-3">
            <Skeleton className="size-16 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-6 w-56 max-w-full" />
              <Skeleton className="h-3 w-36 max-w-full" />
            </div>
          </div>
        )}
        {variant === "scores" ? (
          <>
            <Skeleton className="h-3 w-32" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="space-y-4 rounded-lg border border-border/50 p-4">
                  <Skeleton className="h-2 w-20" />
                  {[0, 1].map((team) => (
                    <div key={team} className="flex items-center gap-3">
                      <Skeleton className="size-6 shrink-0 rounded-full" />
                      <Skeleton className="h-3 w-28" />
                      <Skeleton className="ml-auto size-4" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : variant === "draft" ? (
          <>
            <Skeleton className="h-8 w-80 max-w-full" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-10 w-full sm:w-64" />
            <div className="grid gap-6 md:grid-cols-2">
              {[0, 1].map((team) => (
                <div key={team} className="space-y-3">
                  <div className="flex h-12 items-center gap-3 border-b border-border">
                    <Skeleton className="size-6 rounded-full" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  {Array.from({ length: 12 }, (_, row) => (
                    <div key={row} className="flex h-4 items-center gap-3">
                      <Skeleton className="h-2 w-5" />
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="ml-auto h-2 w-10" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : <TableRows rows={variant === "list" ? 5 : 8} />}
      </div>
    </div>
  )
}
