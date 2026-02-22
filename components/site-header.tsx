import Link from "next/link"
import Image from "next/image"

const NAV_ITEMS = [
  { label: "Scores", href: "/" },
  { label: "Standings", href: "/standings" },
  { label: "Stats", href: "/stats" },
]

export function SiteHeader({ activeTab }: { activeTab?: string }) {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 md:h-14">
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <Image
            src="/logo.gif"
            alt="BASH logo"
            width={32}
            height={32}
            className="shrink-0 md:w-9 md:h-9"
            unoptimized
          />
          <div className="flex flex-col">
            <span className="text-[13px] font-bold leading-tight tracking-tight text-foreground md:text-sm">
              Bay Area Street Hockey
            </span>
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70 md:text-[10px]">
              BASH 2025-2026
            </span>
          </div>
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.label.toLowerCase()
            return (
              <Link
                key={item.label}
                href={item.href}
                className={
                  "text-xs font-semibold px-3 py-1.5 rounded-md transition-colors " +
                  (isActive
                    ? "text-foreground bg-secondary"
                    : "text-muted-foreground/50 hover:text-muted-foreground")
                }
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
