/**
 * Pre-Draft Trade Resolution Engine
 *
 * Processes pre-draft trade swaps sequentially to compute a net pick ownership map.
 * Trades are stored in their human-readable swap format (as entered by the admin)
 * but resolved into final pick ownership for draftPicks pre-generation.
 *
 * Chain trade example:
 *   Trade 1: Team A trades Rd 1 ↔ Team B trades Rd 3
 *   Trade 2: Team B trades Rd 1 (acquired from Team A) ↔ Team C trades Rd 4
 *
 * Resolution:
 *   Initial:  A-Rd1→A, B-Rd3→B, C-Rd4→C
 *   Trade 1:  A-Rd1→B, B-Rd3→A           (swapped)
 *   Trade 2:  A-Rd1→C, C-Rd4→B           (B's acquired A-Rd1 goes to C)
 *
 * Final net transfers:
 *   A-Rd1 → Team C (was A, now C)
 *   B-Rd3 → Team A (was B, now A)
 *   C-Rd4 → Team B (was C, now B)
 */

export interface PreDraftTradeInput {
  teamASlug: string
  teamARound: number
  teamAOriginalOwner: string
  teamBSlug: string
  teamBRound: number
  teamBOriginalOwner: string
}

/** A resolved pick ownership change: originalTeam's round N pick is now owned by newOwner */
export interface PickOwnershipTransfer {
  originalTeamSlug: string
  round: number
  newOwner: string
}

/**
 * Build a pick-slot key for the ownership map.
 * Uses originalOwner + round to uniquely identify each pick slot.
 */
function slotKey(originalTeamSlug: string, round: number): string {
  return `${originalTeamSlug}::${round}`
}

/**
 * Compute the current ownership map after processing all trades sequentially.
 *
 * @param teamSlugs - All team slugs participating in the draft
 * @param rounds - Total number of rounds
 * @param trades - Ordered array of pre-draft trade swaps
 * @returns Map of slot key → current owner team slug
 */
export function resolvePreDraftTrades(
  teamSlugs: string[],
  rounds: number,
  trades: PreDraftTradeInput[]
): Map<string, string> {
  // Initialize: each team owns all their own round picks
  const ownership = new Map<string, string>()
  for (const slug of teamSlugs) {
    for (let r = 1; r <= rounds; r++) {
      ownership.set(slotKey(slug, r), slug)
    }
  }

  // Process each trade sequentially — order matters for chain trades
  for (const trade of trades) {
    const keyA = slotKey(trade.teamAOriginalOwner, trade.teamARound)
    const keyB = slotKey(trade.teamBOriginalOwner, trade.teamBRound)

    const ownerA = ownership.get(keyA)
    const ownerB = ownership.get(keyB)

    if (ownerA !== undefined && ownerB !== undefined) {
      // Swap ownership
      ownership.set(keyA, ownerB)
      ownership.set(keyB, ownerA)
    }
  }

  return ownership
}

/**
 * Extract only the pick slots whose ownership changed from the original.
 *
 * @returns Array of transfers where originalTeam ≠ newOwner
 */
export function getNetTransfers(
  teamSlugs: string[],
  rounds: number,
  trades: PreDraftTradeInput[]
): PickOwnershipTransfer[] {
  const ownership = resolvePreDraftTrades(teamSlugs, rounds, trades)
  const transfers: PickOwnershipTransfer[] = []

  for (const [key, newOwner] of ownership) {
    const [originalTeamSlug, roundStr] = key.split("::")
    const round = parseInt(roundStr)
    if (originalTeamSlug !== newOwner) {
      transfers.push({ originalTeamSlug, round, newOwner })
    }
  }

  // Sort by round, then by originalTeamSlug for consistent ordering
  transfers.sort((a, b) => a.round - b.round || a.originalTeamSlug.localeCompare(b.originalTeamSlug))
  return transfers
}

/**
 * Compute the current pick ownership state after processing trades up to (but not including)
 * a given trade index. Used by the wizard UI to show "(via Team X)" annotations on picks
 * that have changed hands in earlier trades.
 *
 * @param teamSlugs - All team slugs
 * @param rounds - Total rounds
 * @param trades - Full ordered trade list
 * @param upToIndex - Process trades[0..upToIndex-1] only
 * @returns Map of slot key → current owner
 */
export function getOwnershipAtTradeIndex(
  teamSlugs: string[],
  rounds: number,
  trades: PreDraftTradeInput[],
  upToIndex: number
): Map<string, string> {
  return resolvePreDraftTrades(teamSlugs, rounds, trades.slice(0, upToIndex))
}

/**
 * For a given trade index, determine if either side involves an acquired pick.
 * Returns annotations like "(via Team A)" for display in the wizard.
 * Note: This is a simpler check than ownership map resolution — it just
 * compares originalOwner to teamSlug on the trade itself.
 */
export function getTradeAnnotations(
  trade: PreDraftTradeInput
): { sideA: string | null; sideB: string | null } {
  return {
    // Show "(via X)" when the original owner differs from the team trading the pick
    sideA: trade.teamAOriginalOwner !== trade.teamASlug ? trade.teamAOriginalOwner : null,
    sideB: trade.teamBOriginalOwner !== trade.teamBSlug ? trade.teamBOriginalOwner : null,
  }
}
