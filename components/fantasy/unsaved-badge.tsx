import { TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"

/** Sits beside a pick form's Save button while there's something to save. */
export function UnsavedBadge() {
  return (
    <Badge role="status" variant="outline" className="border-amber-500/50 bg-amber-500/15 py-1 text-amber-800 dark:text-amber-300">
      <TriangleAlert aria-hidden />
      Unsaved changes
    </Badge>
  )
}
