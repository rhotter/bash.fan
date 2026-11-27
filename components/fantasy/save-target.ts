/**
 * Who a pick form saves as. A Manager saves with their link's token. An admin saves on a Manager's
 * behalf through that Manager's admin route, which ignores the Lock.
 */
export type SaveTarget = { onSaved?: () => void } & (
  | { token: string; adminUrl?: never }
  | { adminUrl: string; token?: never }
)

export function saveRequest({ token, adminUrl }: SaveTarget, picks: "lineup" | "predictions", body: object) {
  return {
    url: adminUrl === undefined ? `/api/bash/fantasy/${picks}` : `${adminUrl}/${picks}`,
    init: {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    },
  }
}
