"use client"

import { useCallback, useEffect, useRef, type MouseEvent } from "react"

/**
 * Guards unsaved picks on a page showing the Lineup and Predictions forms together. Each form is
 * tracked apart, so one with nothing to save can't hide the other's unsaved picks.
 */
export function useUnsavedPicks() {
  const unsaved = useRef({ lineup: false, predictions: false })
  const hasUnsaved = () => unsaved.current.lineup || unsaved.current.predictions

  const setLineupDirty = useCallback((dirty: boolean) => {
    unsaved.current.lineup = dirty
  }, [])
  const setPredictionsDirty = useCallback((dirty: boolean) => {
    unsaved.current.predictions = dirty
  }, [])

  // Reloading and closing the tab don't go through any link, so the browser has to ask.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (unsaved.current.lineup || unsaved.current.predictions) event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [])

  /** For links that would leave the forms. */
  function confirmLeave(event: MouseEvent) {
    if (hasUnsaved() && !window.confirm("Discard your unsaved changes?")) event.preventDefault()
  }

  return { setLineupDirty, setPredictionsDirty, confirmLeave }
}
