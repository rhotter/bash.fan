import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import bcrypt from "bcryptjs"
import { randomUUID } from "crypto"

/**
 * Public signup endpoint — players create an account with email + password.
 * Email is auto-verified (small hockey league; no spam vector worth gating on).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = (body.email ?? "").toString().trim().toLowerCase()
    const password = (body.password ?? "").toString()
    const name = (body.name ?? "").toString().trim() || null

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 })
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
    }

    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1)
    if (existing.length > 0) {
      return NextResponse.json({ error: "An account with this email already exists. Sign in instead." }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const userId = randomUUID()

    await db.insert(schema.users).values({
      id: userId,
      email,
      name,
      passwordHash,
      emailVerified: new Date(),
    })

    return NextResponse.json({ ok: true, userId }, { status: 201 })
  } catch (err) {
    console.error("Signup failed:", err)
    return NextResponse.json({ error: "Signup failed" }, { status: 500 })
  }
}

export const runtime = "nodejs"
