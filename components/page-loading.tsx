import { LoadingState, type LoadingVariant } from "@/components/loading-state"
import { SiteHeader } from "@/components/site-header"

export function PageLoading({ variant, label, activeTab }: {
  variant: LoadingVariant
  label: string
  activeTab?: string
}) {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <SiteHeader activeTab={activeTab} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        <LoadingState variant={variant} label={label} />
      </main>
    </div>
  )
}
