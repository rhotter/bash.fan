"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MapPin, Calendar, DollarSign, Mail, Info, ExternalLink } from "lucide-react"
import { useEffect, useState } from "react"
import { SiteHeader } from "@/components/site-header"

export default function RegisterPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const closeDate = new Date("2026-05-18T23:59:59")
  const now = mounted ? new Date() : new Date()
  const diffMs = closeDate.getTime() - now.getTime()
  const daysUntil = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <div className="flex-1">
        <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16 text-center space-y-12">

        {/* Header */}
        <div className="space-y-4">
          <Badge variant="outline" className="text-xs uppercase tracking-widest bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20 backdrop-blur-sm">
            Registration Now Open
          </Badge>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">BASH 2026 Summer Season</h1>
          <p className="text-muted-foreground text-lg sm:text-xl max-w-2xl mx-auto">
            We are thrilled to invite you to register for the upcoming BASH 2026 Summer Season!
          </p>
        </div>

        {/* CTA & Countdown */}
        <div className="bg-card border shadow-sm rounded-xl p-6 sm:p-8 space-y-6 max-w-xl mx-auto relative overflow-hidden">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">Secure Your Spot</h2>
            <p className="text-muted-foreground">All skill levels are welcome!</p>
          </div>

          <Button size="lg" className="w-full text-base sm:text-lg h-14 bg-green-600 hover:bg-green-700 text-white" asChild>
            <a href="https://secure.sportability.com/spx/Leagues/League.asp?LgID=50877" target="_blank" rel="noopener noreferrer">
              Register on Sportability
              <ExternalLink className="ml-2 h-5 w-5" />
            </a>
          </Button>

          <div className="pt-4 border-t flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8">
            <div className="space-y-1">
              <div className="text-4xl font-bold tabular-nums text-primary">
                {daysUntil}
              </div>
              <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {daysUntil === 1 ? "day left" : "days left"}
              </div>
            </div>
            <div className="text-left text-sm text-muted-foreground">
              Registration closes on<br />
              <strong className="text-foreground">May 18th, 2026</strong>
            </div>
          </div>
        </div>

        {/* General Info Grid */}
        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto text-left">
          <div className="bg-card border rounded-xl p-5 space-y-2">
            <div className="flex items-center gap-2 font-semibold mb-3">
              <MapPin className="h-5 w-5 text-primary" />
              Location
            </div>
            <p className="text-sm text-muted-foreground">
              <a href="https://www.google.com/search?q=dolores+park+sf" target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">Dolores Park</a>
              <br />San Francisco, CA
            </p>
          </div>
          <div className="bg-card border rounded-xl p-5 space-y-2">
            <div className="flex items-center gap-2 font-semibold mb-3">
              <DollarSign className="h-5 w-5 text-primary" />
              Fee
            </div>
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground text-lg">$60</strong> per player
            </p>
          </div>
          <div className="bg-card border rounded-xl p-5 space-y-2 sm:col-span-2">
            <div className="flex items-center gap-2 font-semibold mb-3">
              <Calendar className="h-5 w-5 text-primary" />
              Schedule & Dates
            </div>
            <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-5">
              <li><strong className="text-foreground">Draft Date:</strong> 5/21</li>
              <li>8-game regular season with Week 1 beginning on <strong className="text-foreground">5/30</strong></li>
              <li>Playoffs will be held on <strong className="text-foreground">8/15</strong> (all teams qualify)</li>
              <li>Times: TBD</li>
            </ul>
          </div>
        </div>

        {/* What's New */}
        <div className="bg-primary/5 border border-primary/10 rounded-xl p-6 sm:p-8 max-w-2xl mx-auto text-left space-y-3">
          <div className="flex items-center gap-2 font-bold text-lg text-primary">
            <Info className="h-5 w-5" />
            What's New?
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            While Sportability will be used to register, we will be utilizing a brand new site for live draft results, stat tracking, and scorekeeping. Stay tuned for the debut, but keep tabs on our official site <a href="http://www.bayareastreethockey.com/" className="text-foreground underline">bayareastreethockey.com</a> throughout the season.
          </p>
        </div>

        {/* Footer / Contact */}
        <div className="pt-8 space-y-4 max-w-md mx-auto">
          <p className="text-sm text-muted-foreground">
            Looking forward to mixing it up with y'all soon!
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-sm font-medium">
            <a href="mailto:sf.bash.hockey@gmail.com" className="flex items-center gap-2 hover:text-primary transition-colors">
              <Mail className="h-4 w-4" />
              sf.bash.hockey@gmail.com
            </a>
          </div>
          <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground pt-2">
            <a href="https://www.instagram.com/bayareastreethockey/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Instagram</a>
            <a href="https://www.facebook.com/groups/bayareastreethockey" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Facebook</a>
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}
