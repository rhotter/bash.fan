import type { Metadata } from "next"

// Fantasy is reached by direct URL until it launches. Delete this file to let search engines index it.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function FantasyLayout({ children }: { children: React.ReactNode }) {
  return children
}
