"use client"

export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body style={{ fontFamily: "system-ui", padding: 24 }}>
    <div role="alert">
      <h1>This site couldn't load.</h1>
      <p>Please try again. If the problem continues, come back in a few minutes.</p>
      <button type="button" onClick={reset}>Try again</button>
    </div>
  </body></html>
}
