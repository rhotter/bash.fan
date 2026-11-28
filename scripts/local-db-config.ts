/**
 * Prints the local database that `pnpm db:setup` should build, as three lines: URL, database
 * name and port. Fails for any other database, because setup pushes schema changes.
 */
import { config } from "dotenv"
import { isLocalDbUrl } from "../lib/db/is-local-db-url"
import { resolveDbUrl } from "../lib/db/resolve-db-url"

// As in the app: the environment wins, then .env.local, then .env.
config({ path: [".env.local", ".env"], quiet: true })

const { targetVar, url = "" } = resolveDbUrl(process.env)

if (!/^postgres(ql)?:\/\//.test(url) || !isLocalDbUrl(url)) {
  console.error(`${targetVar} or DATABASE_URL must point at localhost, without a host or port query parameter; refusing to continue.`)
  process.exit(1)
}

const { pathname, port } = new URL(url)
console.log([url, decodeURI(pathname.slice(1)) || "postgres", port || "5432"].join("\n"))
