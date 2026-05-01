import Link from "next/link"
import { redirect } from "next/navigation"
import { auth, signIn } from "@/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

export const metadata = { title: "Sign in | BASH" }

interface PageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}

export default async function SignInPage({ searchParams }: PageProps) {
  const session = await auth()
  const params = await searchParams
  const callbackUrl = params.callbackUrl || "/account"
  if (session?.user) redirect(callbackUrl)

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1.5">
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>
            Sign in with a magic link or your password. New here?{" "}
            <Link href={`/signup${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`} className="underline">
              Create an account
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {params.error && (
            <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-md border border-destructive/30">
              {params.error === "CredentialsSignin"
                ? "Email or password is incorrect."
                : "Sign-in failed. Try again."}
            </div>
          )}

          <form
            action={async (formData: FormData) => {
              "use server"
              await signIn("resend", { email: formData.get("email"), redirectTo: callbackUrl })
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="magic-email">Email me a magic link</Label>
              <Input id="magic-email" name="email" type="email" placeholder="you@example.com" required autoComplete="email" />
            </div>
            <Button type="submit" className="w-full">Send magic link</Button>
          </form>

          <div className="relative">
            <Separator />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="bg-card px-2 text-[10px] uppercase tracking-wider text-muted-foreground">or</span>
            </span>
          </div>

          <form
            action={async (formData: FormData) => {
              "use server"
              await signIn("credentials", {
                email: formData.get("email"),
                password: formData.get("password"),
                redirectTo: callbackUrl,
              })
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="pwd-email">Email</Label>
              <Input id="pwd-email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pwd-password">Password</Label>
              <Input id="pwd-password" name="password" type="password" required autoComplete="current-password" />
            </div>
            <Button type="submit" variant="outline" className="w-full">Sign in with password</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
