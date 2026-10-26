import { setSessionCookie } from "@/lib/admin-session"
import { checkCredential } from "@/lib/operator-auth"

export async function POST(request: Request) {
  let pin: unknown = request.headers.get("x-pin")
  if (!pin) {
    try { pin = (await request.json()).pin } catch { /* Count malformed attempts too. */ }
  }
  const role = await checkCredential(request, pin)
  if (role instanceof Response) return role
  return setSessionCookie(Response.json({ ok: true, role }, { headers: { "Cache-Control": "no-store" } }), role)
}
