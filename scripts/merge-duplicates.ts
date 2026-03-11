import "./env"
import { mergeDuplicatePlayers } from "../lib/merge-duplicates"

async function main() {
  const result = await mergeDuplicatePlayers()
  if (result.merged === 0) {
    console.log("No duplicates to merge!")
  } else {
    console.log(
      `\nDone! Merged ${result.merged} duplicate players into ${result.groups} canonical entries.`
    )
  }
}

main().catch(console.error)
