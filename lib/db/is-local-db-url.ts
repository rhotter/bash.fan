const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"])

/** True for a Postgres server on this machine, which needs a wire-protocol driver instead of Neon's HTTP one. */
export function isLocalDbUrl(url: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(url).hostname)
  } catch {
    return false
  }
}
