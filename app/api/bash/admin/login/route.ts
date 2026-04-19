import { NextRequest, NextResponse } from "next/server"
import { setSessionCookie } from "@/lib/admin-session"

export async function POST(request: NextRequest) {
  try {
    const { pin } = await request.json()

    if (!pin || pin !== process.env.SCOREKEEPER_PIN) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 })
    }

    const response = NextResponse.json({ ok: true })
    setSessionCookie(response)
    return response
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
}
