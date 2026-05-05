"use client"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  ChevronDown,
  ChevronUp,
  User,
  Calendar,
  Target,
  Trophy,
  Shield,
  Star,
  Users,
} from "lucide-react"
import { useState } from "react"
import type { RegistrationMeta } from "@/lib/csv-utils"

interface PoolPlayer {
  playerId: number
  playerName: string
  isKeeper: boolean
  keeperTeamSlug: string | null
  keeperRound: number | null
  registrationMeta: RegistrationMeta | null
  isGoalie?: boolean
}

interface DraftPlayerCardProps {
  player: PoolPlayer | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Skill level badge config — aligned with prd-draft.md §5.1
const SKILL_BADGE_STYLES: Record<string, string> = {
  "Novice": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "Intermediate -": "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  "Intermediate +": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  "Advanced": "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
}

export function getSkillBadgeClass(skillLevel: string | null | undefined): string {
  if (!skillLevel) return "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
  return SKILL_BADGE_STYLES[skillLevel] || "bg-gray-100 text-gray-500"
}

export function SkillBadge({ skillLevel }: { skillLevel: string | null | undefined }) {
  const label = skillLevel || "—"
  return (
    <Badge variant="outline" className={`text-xs font-medium ${getSkillBadgeClass(skillLevel)}`}>
      {label}
    </Badge>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number | null | undefined }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-start gap-3 py-1.5">
      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <p className="text-sm font-medium truncate">{value}</p>
      </div>
    </div>
  )
}

export function DraftPlayerCard({ player, open, onOpenChange }: DraftPlayerCardProps) {
  const [showSecondary, setShowSecondary] = useState(false)
  const meta = player?.registrationMeta

  if (!player) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {player.playerName}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap gap-1.5 mt-1">
            {meta?.age && <Badge variant="secondary">{meta.age} yrs</Badge>}
            <SkillBadge skillLevel={meta?.skillLevel} />
            {meta?.positions && (
              <Badge variant="outline">{meta.positions}</Badge>
            )}
            {player.isKeeper && (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                Keeper
              </Badge>
            )}
            {meta?.isRookie && (
              <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300">
                Rookie
              </Badge>
            )}
            {meta?.captainPrev && meta.captainPrev !== "" && (
              <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                {meta.captainPrev === "1" ? "Captain (prev)" : `Capt: ${meta.captainPrev}`}
              </Badge>
            )}
          </SheetDescription>
        </SheetHeader>

        <Separator />

        {/* Primary Section — Always visible */}
        <div className="py-4 space-y-1">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Key Info
          </h4>
          <InfoRow icon={Calendar} label="Games Expected" value={meta?.gamesExpected} />
          <InfoRow icon={Trophy} label="Playoff Availability" value={meta?.playoffAvail} />
          <InfoRow icon={Star} label="Experience" value={meta?.yearsPlayed ? `${meta.yearsPlayed} year${meta.yearsPlayed !== 1 ? "s" : ""}` : null} />
          <InfoRow icon={Shield} label="Previous Team" value={meta?.lastTeam} />
          <InfoRow icon={Target} label="Previous League" value={meta?.lastLeague} />
        </div>

        <Separator />

        {/* Secondary Section — Collapsible */}
        <div className="py-4">
          <button
            onClick={() => setShowSecondary(!showSecondary)}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            Additional Info
            {showSecondary ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {showSecondary && (
            <div className="mt-2 space-y-1 animate-in slide-in-from-top-1 duration-200">
              <InfoRow icon={Shield} label="Goalie Willing" value={meta?.goalieWilling} />
              <InfoRow icon={User} label="Gender" value={meta?.gender} />
              <InfoRow icon={Users} label="Buddy Request" value={meta?.buddyReq} />
              {meta?.isNewToBash !== null && meta?.isNewToBash !== undefined && (
                <div className="flex items-start gap-3 py-1.5">
                  <Star className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div>
                    <span className="text-xs text-muted-foreground">New to BASH</span>
                    <p className="text-sm font-medium">{meta.isNewToBash ? "Yes" : "No"}</p>
                  </div>
                </div>
              )}
              <InfoRow icon={User} label="T-Shirt Size" value={meta?.tshirtSize} />
            </div>
          )}
        </div>

        {/* Notes section */}
        {meta?.miscNotes && (
          <>
            <Separator />
            <div className="py-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Notes
              </h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{meta.miscNotes}</p>
            </div>
          </>
        )}

        {/* Pool status info */}
        {player.isKeeper && (
          <>
            <Separator />
            <div className="py-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Keeper Status
              </h4>
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">Team:</span> {player.keeperTeamSlug || "—"}</p>
                <p><span className="text-muted-foreground">Round:</span> {player.keeperRound || "—"}</p>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
