import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { SiteHeader } from "@/components/site-header"
import { MapPin, Clock, ArrowUpRight, Trophy } from "lucide-react"

export const metadata: Metadata = {
    title: "About BASH",
    description: "Learn about the Bay Area Street Hockey league — seasons, venues, FAQ, equipment, and more.",
}

export default function AboutPage() {
    return (
        <div className="flex min-h-svh flex-col bg-background">
            <SiteHeader activeTab="about" />
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 md:py-16">
                {/* Hero */}
                <section className="mb-16 md:mb-20 text-center">
                    <div className="inline-flex items-center gap-3 font-mono text-[10px] font-medium uppercase tracking-[0.28em] text-muted-foreground mb-7">
                        <span className="h-px w-8 bg-border" />
                        Est. 1991 · San Francisco
                        <span className="h-px w-8 bg-border" />
                    </div>
                    <h1 className="text-5xl md:text-7xl font-bold tracking-tighter text-foreground leading-[0.92] mb-6">
                        Bay Area
                        <br />
                        <span className="text-primary">Street Hockey.</span>
                    </h1>
                    <p className="text-muted-foreground max-w-xl mx-auto text-[15px] md:text-base leading-relaxed">
                        BASH is a non-profit, competitive street hockey league founded in 1991. We play on the asphalt of San Francisco, keeping the spirit of outdoor competition alive.
                    </p>
                    <div className="mt-8">
                        <Link
                            href="/register"
                            className="group inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
                        >
                            Register for Summer 2026
                            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </Link>
                    </div>
                </section>

                {/* Quick Links */}
                <section className="mb-16 md:mb-20">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border rounded-xl overflow-hidden border border-border">
                        <Link
                            href="/rulebook"
                            className="group relative flex items-center justify-between gap-4 bg-card px-6 py-5 transition-colors hover:bg-secondary/60"
                        >
                            <div>
                                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-1">Read</div>
                                <div className="text-base font-bold tracking-tight text-foreground">Official Rulebook</div>
                            </div>
                            <ArrowUpRight className="h-5 w-5 shrink-0 text-muted-foreground transition-all duration-200 group-hover:text-primary group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </Link>
                        <Link
                            href="/how-to"
                            className="group relative flex items-center justify-between gap-4 bg-card px-6 py-5 transition-colors hover:bg-secondary/60"
                        >
                            <div>
                                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-1">Browse</div>
                                <div className="text-base font-bold tracking-tight text-foreground">How-To Guides</div>
                            </div>
                            <ArrowUpRight className="h-5 w-5 shrink-0 text-muted-foreground transition-all duration-200 group-hover:text-primary group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </Link>
                    </div>
                </section>

                {/* Seasons */}
                <section className="mb-16 md:mb-20">
                    <SectionHeading title="The Seasons" />
                    <div className="mt-7 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SeasonCard
                            label="Fall Season"
                            range="SEP — APR"
                            format="5-on-5"
                            description="Our primary, highly competitive 5-on-5 season runs from September through April. New players must attend one of our August tryouts/pick-ups to be eligible for the draft."
                            venueName="James Lick Middle School"
                            venueHref="https://www.google.com/maps/place/1220+Noe+St,+San+Francisco,+CA+94114"
                            time="Saturday games · 9AM – 1PM"
                        />
                        <SeasonCard
                            label="Summer Season"
                            range="MAY — AUG"
                            format="4-on-4"
                            description="A slightly less competitive, but just as fun, 4-on-4 season running from May to August. No tryouts needed, all adults are welcome to sign up and play!"
                            venueName="Dolores Park Multi-purpose Court"
                            venueHref="https://maps.app.goo.gl/LgdQFGtyrNMu8Nm69"
                            time="Weekend games · 11AM – 2PM"
                        />
                    </div>
                </section>

                {/* NBHL */}
                <section className="mb-16 md:mb-20">
                    <SectionHeading title="Beyond the Bay" />
                    <div className="mt-7 overflow-hidden rounded-xl border border-border bg-card">
                        <div className="grid md:grid-cols-[220px_1fr]">
                            <div className="flex items-center justify-center border-b border-border bg-secondary/40 p-8 md:border-b-0 md:border-r">
                                <Image
                                    src="/images/bash-nbhl-2024.png"
                                    alt="National Ball Hockey League"
                                    width={180}
                                    height={180}
                                    className="h-auto w-32 object-contain md:w-36"
                                />
                            </div>
                            <div className="p-6 md:p-8">
                                <div className="mb-3 flex items-center gap-2">
                                    <Trophy className="h-3.5 w-3.5 text-primary" />
                                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">NBHL Competition</span>
                                </div>
                                <h3 className="mb-4 text-xl md:text-2xl font-bold tracking-tight text-foreground">California Division</h3>
                                <p className="mb-6 text-sm md:text-[15px] text-muted-foreground leading-relaxed">
                                    BASH currently fields one Tier 2 team, and 3 Tier 3 teams that compete in the California Division of the{" "}
                                    <span className="font-semibold text-foreground">National Ball Hockey League (NBHL)</span>. If we win our division during the summer weekends in SoCal, the League Finals take place in New Jersey in September. Our teams are open to any players who have played in BASH, selected based on talent, experience, availability and team chemistry.
                                </p>
                                <a
                                    href="mailto:sf.bash.hockey@gmail.com"
                                    className="group inline-flex items-center gap-1 text-sm font-semibold text-primary"
                                >
                                    sf.bash.hockey@gmail.com
                                    <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                                </a>
                            </div>
                        </div>
                    </div>
                </section>

                {/* FAQ */}
                <section>
                    <SectionHeading title="FAQ" />
                    <dl className="mt-7 border-t border-border">
                        <div className="border-b border-border py-5">
                            <dt className="mb-2 text-[15px] font-bold tracking-tight text-foreground">Do I need experience?</dt>
                            <dd className="text-sm leading-relaxed text-muted-foreground">
                                No! All adults (18+) are welcome. We recommend stopping by a Dolores Park pick-up to watch or run a few shifts if you&apos;re unsure.
                            </dd>
                        </div>
                        <div className="border-b border-border py-5">
                            <dt className="mb-2 text-[15px] font-bold tracking-tight text-foreground">How do I follow BASH?</dt>
                            <dd className="text-sm leading-relaxed text-muted-foreground">
                                Check out our{" "}
                                <a href="https://www.facebook.com/groups/bayareastreethockey" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:no-underline">Facebook group</a>,{" "}
                                <a href="https://www.instagram.com/bayareastreethockey/" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:no-underline">Instagram</a>, or sign up for our{" "}
                                <a href="https://forms.gle/Y5zH9dpSrg9KDqoM6" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:no-underline">mailing list</a>.
                            </dd>
                        </div>
                        <div className="border-b border-border py-5">
                            <dt className="mb-2 text-[15px] font-bold tracking-tight text-foreground">What gear do I need?</dt>
                            <dd className="text-sm leading-relaxed text-muted-foreground">
                                Street hockey is a physical activity — there is a risk of injury from sticks, balls, or other players, so it&apos;s important to protect yourself. Recommended gear: a hockey stick, sturdy sneakers, shin pads, groin protection, gloves, and eye protection.
                            </dd>
                        </div>
                    </dl>
                </section>
            </main>
        </div>
    )
}

function SectionHeading({ title }: { title: string }) {
    return (
        <div className="flex items-baseline gap-3">
            <h2 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">{title}</h2>
            <div className="h-px flex-1 bg-border" />
        </div>
    )
}

function SeasonCard({
    label,
    range,
    format,
    description,
    venueName,
    venueHref,
    time,
}: {
    label: string
    range: string
    format: string
    description: string
    venueName: string
    venueHref: string
    time: string
}) {
    return (
        <article className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="p-6 md:p-7">
                <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</span>
                    <span className="font-mono text-[10px] font-bold tracking-wider text-foreground/60">
                        {format}
                    </span>
                </div>
                <div className="mb-5 font-mono text-3xl md:text-[2rem] font-bold tracking-tight tabular-nums text-foreground">
                    {range}
                </div>
                <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{description}</p>
                <div className="space-y-3 border-t border-border pt-4">
                    <div className="flex items-start gap-2.5">
                        <MapPin className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
                        <div className="text-sm">
                            <a
                                href={venueHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-foreground underline decoration-border underline-offset-4 hover:decoration-primary"
                            >
                                {venueName}
                            </a>
                        </div>
                    </div>
                    <div className="flex items-start gap-2.5">
                        <Clock className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="text-sm text-muted-foreground">{time}</span>
                    </div>
                </div>
            </div>
        </article>
    )
}
