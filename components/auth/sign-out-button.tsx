import { signOut } from "@/auth"
import { Button } from "@/components/ui/button"
import { LogOut } from "lucide-react"

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server"
        await signOut({ redirectTo: "/" })
      }}
    >
      <Button variant="ghost" size="sm" type="submit">
        <LogOut className="h-3.5 w-3.5 mr-1.5" />
        Sign out
      </Button>
    </form>
  )
}
