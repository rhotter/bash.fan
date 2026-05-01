import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Mail } from "lucide-react"

export const metadata = { title: "Check your email | BASH" }

export default function CheckEmailPage() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
            <Mail className="h-5 w-5" />
          </div>
          <CardTitle className="text-xl">Check your email</CardTitle>
          <CardDescription>
            We sent you a magic link. Click it from your email to sign in. The link expires in 24 hours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Didn&apos;t get it? Check your spam folder, or{" "}
            <Link href="/signin" className="underline">try again</Link>.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
