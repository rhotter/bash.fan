import NextAuth from "next-auth"
import Resend from "next-auth/providers/resend"
import Credentials from "next-auth/providers/credentials"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import bcrypt from "bcryptjs"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin/check-email",
  },
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.AUTH_EMAIL_FROM ?? "BASH <noreply@bash.fan>",
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        const email = (creds?.email ?? "").toString().trim().toLowerCase()
        const password = (creds?.password ?? "").toString()
        if (!email || !password) return null

        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1)

        if (!user || !user.passwordHash) return null
        const ok = await bcrypt.compare(password, user.passwordHash)
        if (!ok) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
        }
      },
    }),
  ],
  callbacks: {
    // Surface user.id on the session object so downstream code can read it.
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id
      return token
    },
    async session({ session, token }) {
      if (token.uid && session.user) {
        // @ts-expect-error - augmenting session.user.id
        session.user.id = token.uid
      }
      return session
    },
  },
})
