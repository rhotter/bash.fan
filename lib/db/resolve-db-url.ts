// DB_TARGET selects which connection string to use: "dev" → DATABASE_URL_DEV,
// "prod" → DATABASE_URL_PROD. Falls back to plain DATABASE_URL if unset.
// In local development, defaults to "dev". On Vercel / production, defaults to "prod".
export function resolveDbUrl(env: Record<string, string | undefined>) {
  const defaultTarget = env.VERCEL_ENV === "production" ? "prod" : "dev"
  const target = (env.DB_TARGET ?? defaultTarget).toLowerCase()
  const targetVar = `DATABASE_URL_${target.toUpperCase()}`
  const source = env[targetVar] === undefined ? "DATABASE_URL" : targetVar
  return { target, targetVar, source, url: env[source] }
}
