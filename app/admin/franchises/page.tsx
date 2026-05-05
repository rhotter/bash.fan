import { FranchiseManager } from "@/components/admin/franchise-manager"

export default function FranchisesPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">Franchises</h1>
        <p className="text-sm text-muted-foreground">
          Manage franchise identities and colors used across seasons.
        </p>
      </div>
      <FranchiseManager />
    </div>
  )
}
