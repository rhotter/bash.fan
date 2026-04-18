import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { SiteHeader } from "@/components/site-header"
import { Card, CardContent } from "@/components/ui/card"
import { Info, MapPin, Calendar, Map, ShieldAlert, HelpCircle, BookOpen, Wrench } from "lucide-react"

export const metadata: Metadata = {
    title: "About BASH",
    description: "Learn about the Bay Area Street Hockey league — seasons, venues, FAQ, equipment, and more.",
}

export default function AboutPage() {
    return (
        <div className="flex min-h-svh flex-col bg-background">
            <SiteHeader activeTab="league" />
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:py-12">
                {/* Hero */}
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-2 text-primary mb-3">
                        <Info className="h-5 w-5" />
                        <span className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">About</span>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-3">
                        Bay Area Street Hockey
                    </h1>
                    <p className="text-muted-foreground max-w-2xl mx-auto text-sm md:text-base leading-relaxed">
                        BASH is a non-profit, competitive street hockey league founded in 1991. We play on the asphalt of San Francisco, keeping the spirit of outdoor competition alive.
                    </p>
                </div>

                {/* Quick Links */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-12 max-w-md mx-auto">
                    <Link
                        href="/rulebook"
                        className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
                    >
                        <BookOpen className="h-4 w-4 text-primary" />
                        Official Rulebook
                    </Link>
                    <Link
                        href="/how-to"
                        className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
                    >
                        <Wrench className="h-4 w-4 text-primary" />
                        How-To Guides
                    </Link>
                </div>

                {/* Seasons */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
                    <Card>
                        <CardContent className="p-5 md:p-6">
                            <div className="flex items-center gap-2.5 text-primary mb-3">
                                <Calendar className="h-5 w-5" />
                                <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Fall Season</h2>
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed mb-5">
                                Our primary, highly competitive 5-on-5 season runs from September through April. New players must attend one of our August tryouts/pick-ups to be eligible for the draft.
                            </p>
                            <div className="border-t border-border pt-4 flex items-start gap-2.5">
                                <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                                <span className="text-sm text-muted-foreground">
                                    Saturday games (9AM – 1PM) at{" "}
                                    <a
                                        href="https://www.google.com/maps/place/1220+Noe+St,+San+Francisco,+CA+94114"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-semibold text-primary hover:underline underline-offset-2"
                                    >
                                        James Lick Middle School
                                    </a>
                                    , 1220 Noe Street, SF
                                </span>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-5 md:p-6">
                            <div className="flex items-center gap-2.5 text-primary mb-3">
                                <Map className="h-5 w-5" />
                                <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Summer Season</h2>
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed mb-5">
                                A slightly less competitive, but just as fun, 4-on-4 season running from May to August. No tryouts needed, all adults are welcome to sign up and play!
                            </p>
                            <div className="border-t border-border pt-4 flex items-start gap-2.5">
                                <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                                <span className="text-sm text-muted-foreground">
                                    Weekend games (11AM – 2PM) at{" "}
                                    <a
                                        href="https://maps.app.goo.gl/LgdQFGtyrNMu8Nm69"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-semibold text-primary hover:underline underline-offset-2"
                                    >
                                        Dolores Park Multi-purpose Court
                                    </a>
                                    , San Francisco
                                </span>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* NBHL */}
                <Card className="mb-10">
                    <CardContent className="p-5 md:p-6 flex flex-col md:flex-row gap-6 items-center md:items-start">
                        <div className="shrink-0 w-28 md:w-36 rounded-lg bg-secondary p-3 flex items-center justify-center">
                            <Image
                                src="/images/bash-nbhl-2024.png"
                                alt="National Ball Hockey League"
                                width={140}
                                height={140}
                                className="w-full h-auto object-contain"
                            />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground mb-2">NBHL Competition</h2>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                BASH currently fields one Tier 2 team, and 3 Tier 3 teams that compete in the California Division of the{" "}
                                <span className="font-semibold text-foreground">National Ball Hockey League (NBHL)</span>. If we win our division during the summer weekends in SoCal, the League Finals take place in New Jersey in September. Our teams are open to any players who have played in BASH, selected based on talent, experience, availability and team chemistry. Questions? Contact{" "}
                                <a
                                    href="mailto:sf.bash.hockey@gmail.com"
                                    className="font-semibold text-primary hover:underline"
                                >
                                    sf.bash.hockey@gmail.com
                                </a>.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* FAQ & Equipment */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <div className="flex items-center gap-2.5 text-primary mb-4">
                            <HelpCircle className="h-5 w-5" />
                            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">FAQ</h2>
                        </div>
                        <div className="space-y-3">
                            <Card>
                                <CardContent className="p-4">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-foreground mb-1.5">Do I need experience?</h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed">
                                        No! All adults (18+) are welcome. We recommend stopping by a Dolores Park pick-up to watch or run a few shifts if you&apos;re unsure.
                                    </p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="p-4">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-foreground mb-1.5">How to follow BASH?</h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed">
                                        Check out our{" "}
                                        <a href="https://www.facebook.com/groups/bayareastreethockey" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">Facebook group</a>,{" "}
                                        <a href="https://www.instagram.com/bayareastreethockey/" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">Instagram</a>, or sign up for our{" "}
                                        <a href="https://forms.gle/Y5zH9dpSrg9KDqoM6" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">mailing list</a>.
                                    </p>
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center gap-2.5 text-primary mb-4">
                            <ShieldAlert className="h-5 w-5" />
                            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Equipment & Risk</h2>
                        </div>
                        <Card>
                            <CardContent className="p-4">
                                <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-destructive bg-destructive/10 border border-destructive/20 px-2 py-0.5 rounded mb-3">
                                    Play at your own risk
                                </span>
                                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                                    Street hockey is a physical activity. There is a risk of injury from sticks, balls, or other players. It&apos;s important to protect yourself.
                                </p>
                                <h4 className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Recommended Gear</h4>
                                <ul className="grid grid-cols-2 gap-y-2 text-sm text-foreground font-medium">
                                    {["Hockey Stick", "Sturdy Sneakers", "Shin Pads", "Groin Protection", "Gloves", "Eye Protection"].map((item) => (
                                        <li key={item} className="flex items-center gap-2">
                                            <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                                            {item}
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </main>
        </div>
    )
}
