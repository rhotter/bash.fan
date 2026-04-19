import { NextResponse } from "next/server"
import { setSessionCookie } from "@/lib/admin-session"

export async function POST(request: Request) {
  const pin = request.headers.get("x-pin")
  if (pin && pin === process.env.SCOREKEEPER_PIN) {
    const response = NextResponse.json({ ok: true })
    return setSessionCookie(response)
  }
  return NextResponse.json({ error: "Invalid PIN" }, { status: 401 })
}
