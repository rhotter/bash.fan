import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import console from "node:console"

// Use the same Sharp dependency as Next's image optimizer.
const require = createRequire(import.meta.url)
const sharp = createRequire(require.resolve("next/package.json"))("sharp")
const root = path.resolve(import.meta.dirname, "..")
const output = path.join(root, "public/optimized-logos")
await mkdir(output, { recursive: true })
const sources = ["/logo.png", ...(await readdir(path.join(root, "public/team-logos")))
  .filter((file) => file.endsWith(".png")).sort().map((file) => `/team-logos/${file}`)]
const manifest = {}
let totalBytes = 0
for (const source of sources) {
  const original = await readFile(path.join(root, "public", source))
  const variants = {}
  for (const width of [64, 128, 256]) {
    const image = await sharp(original).resize(width, width, {
      fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).webp({ quality: 80 }).toBuffer()
    const hash = createHash("sha256").update(image).digest("hex").slice(0, 12)
    const filename = `${path.basename(source, ".png")}-${width}-${hash}.webp`
    await writeFile(path.join(output, filename), image)
    variants[width] = `/optimized-logos/${filename}`
    totalBytes += image.length
  }
  manifest[source] = variants
}
await writeFile(path.join(root, "lib/optimized-logos.json"), JSON.stringify(manifest, null, 2) + "\n")
console.log(`Optimized ${sources.length} logos at 64/128/256px (${totalBytes.toLocaleString()} bytes total)`)
