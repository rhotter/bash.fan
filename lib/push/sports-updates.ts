import { dispatchGameAlerts } from "./dispatch"
import { dispatchLiveScores } from "./live-scores"
export async function dispatchSportsUpdates() {
 const [alerts, activities] = await Promise.allSettled([dispatchGameAlerts(), dispatchLiveScores()])
 if (alerts.status === "rejected") console.error("Alert dispatch failed", alerts.reason)
 if (activities.status === "rejected") console.error("Live score dispatch failed", activities.reason)
 return { alerts: alerts.status === "fulfilled" ? alerts.value : { failed: true }, activities: activities.status === "fulfilled" ? activities.value : { failed: true } }
}
