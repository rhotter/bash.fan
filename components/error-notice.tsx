"use client"

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div role="alert" className="my-4 rounded-md border border-destructive/30 p-4 text-sm">
    <p>{message}</p>
    <button type="button" onClick={onRetry ?? (() => window.location.reload())}
      className="mt-2 text-xs font-semibold underline underline-offset-4">Try again</button>
  </div>
}
