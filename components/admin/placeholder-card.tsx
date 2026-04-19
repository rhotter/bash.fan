import { Construction } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

export function PlaceholderCard({ title, phase }: { title: string; phase: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <Construction className="h-8 w-8 text-muted-foreground mb-3" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Coming in Phase {phase}
        </p>
      </CardContent>
    </Card>
  )
}
