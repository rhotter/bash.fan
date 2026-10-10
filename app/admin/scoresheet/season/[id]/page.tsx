import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AutoPrint } from "@/components/admin/auto-print"
import { GameScoresheet } from "@/components/admin/game-scoresheet"
import { BatchScoresheetToolbar } from "./batch-toolbar"
import { fetchBatchScoresheets } from "@/lib/fetch-scoresheets"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id: rawId } = await params
  let seasonId: string
  try {
    seasonId = decodeURIComponent(rawId)
  } catch {
    seasonId = rawId
  }

  const data = await fetchBatchScoresheets(seasonId)
  const seasonName = data?.season.name || seasonId

  return {
    title: `${seasonName} Batch Scoresheets | BASH Admin`,
    description: `Print-ready batch scoresheet view for all remaining games in ${seasonName}.`,
  }
}

export default async function BatchScoresheetPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: rawId } = await params
  let seasonId: string
  try {
    seasonId = decodeURIComponent(rawId)
  } catch {
    seasonId = rawId
  }

  const data = await fetchBatchScoresheets(seasonId)

  if (!data) {
    notFound()
  }

  const { season, games } = data

  if (games.length === 0) {
    return (
      <div className="min-h-screen bg-background -m-4 md:-m-6 lg:-m-8">
        <BatchScoresheetToolbar seasonName={season.name} seasonId={season.id} gameCount={0} />
        <div className="max-w-md mx-auto my-16 p-8 bg-card border rounded-lg text-center shadow-xs">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-4">
            <Printer className="h-6 w-6 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-1">No Remaining Games</h2>
          <p className="text-sm text-muted-foreground mb-6">
            All scheduled games in {season.name} are already final, or no upcoming games were found.
          </p>
          <Button asChild variant="outline">
            <Link href={`/admin/seasons/${encodeURIComponent(seasonId)}`}>Back to Season Schedule</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <AutoPrint />
      <style>{`
        @page {
          size: letter;
          margin: 0.25in;
        }

        @media print {
          /* Hide non-printable admin UI */
          header,
          nav,
          aside,
          [data-sidebar],
          [data-sidebar="sidebar"],
          [data-sidebar="rail"],
          [data-sonner-toaster],
          .no-print {
            display: none !important;
          }

          html,
          body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            display: block !important;
            min-height: 0 !important;
            height: auto !important;
            overflow: visible !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          main,
          [data-slot="sidebar-wrapper"],
          [data-slot="sidebar-inset"],
          [data-sidebar="inset"],
          .min-h-screen {
            min-height: 0 !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            display: block !important;
            overflow: visible !important;
          }

          .scoresheet-batch-container {
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }

          .scoresheet-page {
            box-shadow: none !important;
            margin: 0 !important;
            padding: 4px 6px !important;
            width: 100% !important;
            break-after: page !important;
            page-break-after: always !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            box-sizing: border-box !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .scoresheet-page:last-child {
            break-after: auto !important;
            page-break-after: auto !important;
          }
        }

        @media screen {
          body {
            background: #f0f0f0;
          }
          .scoresheet-batch-container {
            padding: 12px 0 40px 0;
          }
          .scoresheet-page {
            max-width: 210mm;
            margin: 20px auto;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          }
        }
      `}</style>

      <div className="min-h-screen bg-muted/20 -m-4 md:-m-6 lg:-m-8">
        <BatchScoresheetToolbar seasonName={season.name} seasonId={season.id} gameCount={games.length} />

        <div className="scoresheet-batch-container">
          {games.map(({ game, homeRoster, awayRoster, officials }) => (
            <GameScoresheet
              key={game.id}
              game={game}
              homeRoster={homeRoster}
              awayRoster={awayRoster}
              officials={officials}
            />
          ))}
        </div>
      </div>
    </>
  )
}
