import manifest from "@/lib/optimized-logos.json"

// Shared 2x assets cover small icons and detail headers without an on-demand
// image transformation. Content hashes keep browser caches valid across deploys.
export function getOptimizedLogoUrl(source: string, displaySize: number): string {
  const variants = (manifest as Record<string, Record<string, string>>)[source]
  if (!variants || displaySize * 2 > 256) return source
  const width = displaySize * 2 <= 64 ? 64 : displaySize * 2 <= 128 ? 128 : 256
  return variants[width]
}
