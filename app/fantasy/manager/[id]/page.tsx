import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { IntentLink } from "@/components/intent-link"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { ManagerHistory } from "@/components/fantasy/manager-history"
import { DEFAULT_CONTEST } from "@/lib/fantasy/view-state"
import { fantasyHref } from "@/lib/fantasy/view-state"
import { parseManagerId } from "@/lib/fantasy/managers"
import { fetchFantasyManagerPageData } from "@/lib/cached-page-data"

export const revalidate = 30

type Params = { params: Promise<{ id: string }> }

async function load({ params }: Params) {
  const managerId = parseManagerId((await params).id)
  return managerId === null ? null : fetchFantasyManagerPageData(managerId)
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const data = await load(props)
  return {
    title: data ? `${data.teamName} · Fantasy` : "Fantasy",
    description: data ? `${data.teamName}'s BASH Fantasy and Pick'em season.` : undefined,
  }
}

export default async function FantasyManagerPage(props: Params) {
  const data = await load(props)
  if (!data) notFound()

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 md:py-8">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <IntentLink href={fantasyHref({ tab: "fantasy", weekId: null, contest: data.contest === DEFAULT_CONTEST ? undefined : data.contest })}>
                  Fantasy
                </IntentLink>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{data.teamName}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{data.teamName}</h1>
        <ManagerHistory history={data.history} pickem={data.pickemHistory} own={false} />
      </main>
    </div>
  )
}
