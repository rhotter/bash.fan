import { dispatchSportsUpdates } from "@/lib/push/sports-updates"
export const maxDuration = 60
export async function GET(request: Request) {
 if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response(null, { status: 401 })
 return Response.json(await dispatchSportsUpdates(), { headers: { "Cache-Control": "no-store" } })
}
