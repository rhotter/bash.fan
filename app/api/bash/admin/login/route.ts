import { NextRequest, NextResponse } from "next/server"
import { setSessionCookie } from "@/lib/admin-session"
import { checkCredential } from "@/lib/operator-auth"
import { reviewPinMatches, setReviewCookie } from "@/lib/video/review-access"

export async function POST(request: NextRequest) {
  try {
    const { pin } = await request.json()

    if (process.env.VIDEO_ENABLED === "1" && process.env.VIDEO_REVIEW_SESSION_ID && reviewPinMatches(pin)) {
      return setReviewCookie(NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }))
    }

    const role = await checkCredential(request, pin, true)
    if (role instanceof Response) return role

    const response = NextResponse.json({ ok: true, role: "admin" }, { headers: { "Cache-Control": "no-store" } })
    setSessionCookie(response)
    return response
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
}
