const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"])

// node-postgres lets these query parameters override the address in the URL.
const ADDRESS_OVERRIDES = ["host", "port"]

/** True for a Postgres server on this machine, which needs a wire-protocol driver instead of Neon's HTTP one. */
export function isLocalDbUrl(url: string): boolean {
  try {
    const { hostname, searchParams } = new URL(url)
    return LOCAL_HOSTNAMES.has(hostname) && !ADDRESS_OVERRIDES.some((name) => searchParams.has(name))
  } catch {
    return false
  }
}
