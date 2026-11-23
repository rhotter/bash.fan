import { NextResponse } from "next/server"
import { fetchPlayoffOddsPageData } from "@/lib/cached-page-data"
import { getCurrentSeason, getSeasonById } from "@/lib/seasons"
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
          { error: 'Invalid simulation mode. Expected "weighted", "50_50", or "classic".' },
          { status: 400 }
        )
      }
      mode = modeParam
    }

    // Validate and canonicalize season before entering cache/simulation to prevent
    // arbitrary query strings from causing CPU exhaustion or unbounded cache growth.
    let canonicalSeasonId: string
    if (seasonParam !== null && seasonParam.trim() !== "") {
      const matched = await getSeasonById(seasonParam)
      if (!matched) {
        return NextResponse.json({ error: "Unknown season." }, { status: 404 })
      }
      canonicalSeasonId = matched.id
    } else {
      canonicalSeasonId = (await getCurrentSeason()).id
    }

    const snapshot = await fetchPlayoffOddsPageData(canonicalSeasonId, mode)

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control":
          snapshot.seasonStatus === "completed"
            ? "public, s-maxage=3600, stale-while-revalidate=86400"
            : "public, s-maxage=60, stale-while-revalidate=120",
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
