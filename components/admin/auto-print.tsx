"use client"

import { useEffect } from "react"

export function AutoPrint() {
  useEffect(() => {
    // Small delay to ensure the page is fully rendered before triggering print
    const timer = setTimeout(() => {
      try {
        if (typeof window !== "undefined" && typeof window.print === "function") {
          window.print()
        }
      } catch (err) {
        console.warn("AutoPrint could not trigger window.print:", err)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [])

  return null
}
