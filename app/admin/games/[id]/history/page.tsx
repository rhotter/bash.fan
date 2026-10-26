import { GameScoreHistory } from "@/components/admin/game-score-history"
export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <GameScoreHistory gameId={id} />
}
