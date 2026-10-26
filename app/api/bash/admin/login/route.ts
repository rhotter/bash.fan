import { NextRequest, NextResponse } from "next/server"
import { setSessionCookie } from "@/lib/admin-session"
import { checkCredential } from "@/lib/operator-auth"

export async function POST(request: NextRequest) {
  try {
    const { pin } = await request.json()

    const role = await checkCredential(request, pin, true)
    if (role instanceof Response) return role

    const response = NextResponse.json({ ok: true, role: "admin" }, { headers: { "Cache-Control": "no-store" } })
    setSessionCookie(response)
    return response
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
}
