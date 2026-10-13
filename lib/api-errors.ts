type ErrorBody = { error?: unknown; details?: unknown; stateSaved?: unknown }

export function apiErrorMessage(response: Pick<Response, "status" | "url">, body: ErrorBody = {}): string {
  if (response.status === 401) return /\/admin\/(login|validate-pin)(?:\?|$)/.test(response.url ?? "")
    ? "Invalid PIN. Please try again." : "Please sign in again to continue."
  if (response.status === 403) return "You don't have permission to do that. Ask an administrator for help."
  if (response.status === 429) return "Too many requests. Wait a moment, then try again."
  if (response.status >= 500) return body.stateSaved === true
    ? "The game was saved, but its statistics could not finish updating. Retry saving this game."
    : "The request couldn't finish. Reload to check the latest data before trying again."
  if (typeof body.error === "string" && body.error.trim() && !/<[^>]+>|\b(?:SELECT .+ FROM|INSERT INTO|UPDATE .+ SET|DELETE FROM)\b|postgres|ECONN|stack trace|duplicate key|violates .+ constraint/i.test(body.error)) {
    return body.error.slice(0, 1000)
  }
  if (response.status === 404) return "This item could not be found. Reload the page and try again."
  if (response.status === 409) return "This item changed or cannot be edited right now. Reload it before trying again."
  if (response.status === 400 || response.status === 422) return "Check the information you entered and try again."
  return "The request could not be completed. Please try again."
}

/** Preserve error payload fields (including saved-state recovery), but never
 * expose HTML error pages, raw SQL, or server stack traces in user messages. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readApiJson(response: Response): Promise<any> {
  let body
  try {
    body = await response.json()
  } catch {
    if (response.ok !== false) throw new Error("The server returned an unexpected response. Reload the page and try again.")
    body = {}
  }
  if (response.ok === false) {
    const fields = body && typeof body === "object" && !Array.isArray(body) ? body : {}
    return { ...fields, error: apiErrorMessage(response, fields), ...(response.status >= 500 ? { details: undefined } : {}) }
  }
  return body
}

/** Keep mutation status handling at its call site. Failed reads must reject so
 * loaders never mistake an error response for an empty successful result. */
export async function fetchApi(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET")
  let response: Response
  try {
    response = await fetch(input, init)
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error
    const authRequest = typeof input === "string" && /\/admin\/(login|validate-pin|logout)(?:\?|$)/.test(input)
    throw new Error(method.toUpperCase() === "GET" || authRequest
      ? "Could not connect. Check your connection and try again."
      : "Could not confirm whether the request completed. Check your connection and reload before trying again.", { cause: error })
  }
  if (method.toUpperCase() === "GET" && response.ok === false) {
    const body = await readApiJson(response)
    throw new Error(body.error)
  }
  return response
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof TypeError || error instanceof SyntaxError) return "The response couldn't be processed. Reload the page and try again."
  if (error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError)) return error.message || fallback
  return fallback
}
