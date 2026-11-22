import { NextResponse } from "next/server"
import { fetchPlayoffOddsPageData } from "@/lib/cached-page-data"
import { isValidPlayoffOddsMode, type PlayoffOddsMode } from "@/lib/playoff-odds-types"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const seasonParam = searchParams.get("season")
    const modeParam = searchParams.get("mode")

    if (seasonParam === "all") {
      return NextResponse.json(
        { error: "Playoff odds require a specific season rather than All Time view." },
        { status: 400 }
      )
    }

    let mode: PlayoffOddsMode = "weighted"
    if (modeParam !== null) {
      if (!isValidPlayoffOddsMode(modeParam)) {
        return NextResponse.json(
          { error: `Invalid mode "${modeParam}". Expected "weighted", "50_50", or "classic".` },
          { status: 400 }
        )
      }
      mode = modeParam
    }

    const snapshot = await fetchPlayoffOddsPageData(seasonParam, mode)

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    })
  } catch (error) {
    console.error("Failed to compute playoff odds:", error)
    return NextResponse.json(
      { error: "Failed to calculate playoff odds" },
      { status: 500 }
    )
  }
}
