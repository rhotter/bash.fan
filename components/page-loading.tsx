import { LoadingState, type LoadingVariant } from "@/components/loading-state"

export function PageLoading({ variant, label }: {
  variant: LoadingVariant
  label: string
}) {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        <LoadingState variant={variant} label={label} />
      </main>
    </div>
  )
}
