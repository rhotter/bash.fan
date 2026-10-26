import { NextResponse } from "next/server"
import { getSession } from "@/lib/admin-session"

export async function GET() {
  const isAdmin = await getSession()
  return NextResponse.json({ isAdmin }, { headers: { "Cache-Control": "private, no-store" } })
}
