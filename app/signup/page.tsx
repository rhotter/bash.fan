import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SignupForm } from "@/components/auth/signup-form"

export const metadata = { title: "Create account | BASH" }

interface PageProps {
  searchParams: Promise<{ callbackUrl?: string }>
}

export default async function SignUpPage({ searchParams }: PageProps) {
  const session = await auth()
  const params = await searchParams
  const callbackUrl = params.callbackUrl || "/account"
  if (session?.user) redirect(callbackUrl)

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Create your account</CardTitle>
          <CardDescription>
            Already have one?{" "}
            <Link href={`/signin${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`} className="underline">
              Sign in
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm callbackUrl={callbackUrl} />
        </CardContent>
      </Card>
    </div>
  )
}
