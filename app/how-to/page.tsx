"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { SiteHeader } from "@/components/site-header"
import { Card, CardContent } from "@/components/ui/card"
import { Wrench, Package, AlertTriangle, CheckCircle, X, HelpCircle, ArrowLeft } from "lucide-react"

const TABS = [
    { id: "boards" as const, label: "Assembling the Boards", icon: Wrench },
    { id: "shed" as const, label: "Packing the Shed", icon: Package },
]

export default function HowToPage() {
    const [activeTab, setActiveTab] = useState<"boards" | "shed">("boards")

    return (
        <div className="flex min-h-svh flex-col bg-background">
            <SiteHeader activeTab="league" />
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:py-12">
                {/* Back link */}
                <Link
                    href="/about"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-6"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to About
                </Link>

                {/* Hero */}
                <div className="text-center mb-10">
                    <div className="inline-flex items-center gap-2 text-primary mb-3">
                        <Wrench className="h-5 w-5" />
                        <span className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Guides</span>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-3">
                        BASH How-To
                    </h1>
                    <p className="text-muted-foreground max-w-2xl mx-auto text-sm md:text-base leading-relaxed">
                        Essential guides for community members. Since BASH is entirely volunteer-run, we rely on everyone to pitch in with setup and breakdown.
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border mb-8">
                    {TABS.map((tab) => {
                        const Icon = tab.icon
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={
                                    "flex-1 flex items-center justify-center gap-2 py-3 text-xs sm:text-sm font-semibold uppercase tracking-wider transition-colors border-b-2 " +
                                    (activeTab === tab.id
                                        ? "text-foreground border-primary"
                                        : "text-muted-foreground/50 border-transparent hover:text-muted-foreground")
                                }
                            >
                                <Icon className="h-4 w-4" />
                                {tab.label}
                            </button>
                        )
                    })}
                </div>

                {/* Boards Tab */}
                {activeTab === "boards" && (
                    <div className="space-y-4 animate-in fade-in duration-300">
                        <div className="flex justify-center mb-6">
                            <Image
                                src="/images/howto/assemble-1-header.png"
                                alt="How to Assemble the Boards"
                                width={600}
                                height={300}
                                className="rounded-lg max-w-full h-auto"
                            />
                        </div>

                        <Card>
                            <CardContent className="p-5">
                                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground mb-3">
                                    <AlertTriangle className="h-4 w-4 text-primary" /> First Steps
                                </h2>
                                <p className="text-sm text-muted-foreground leading-relaxed mb-2">
                                    Look around, is the rink ready? Are you a goalie? No: then pitch in and help. Either with the boards, nets, sweeping, or netting.
                                </p>
                                <p className="text-sm text-foreground leading-relaxed font-medium">
                                    Is the rink still not ready? Do not shoot at the east end until the netting is finished. Your fellow BASHers are working to get the rink ready.
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="p-5">
                                <h3 className="text-sm font-bold uppercase tracking-wider text-foreground mb-3">The Boards</h3>
                                <p className="text-sm text-muted-foreground mb-2">
                                    There are 24 total white board pieces: 10 Support, 9 Straight Long, 3 Curved, 1 Straight Medium, and 1 Corner.
                                </p>
                                <p className="text-sm text-muted-foreground mb-4 font-medium">Start on the east end closest to the shed.</p>
                                <ol className="space-y-3 text-sm text-muted-foreground">
                                    {[
                                        "Place the one corner piece next to where the benches stop.",
                                        "Building out from the wall: Support, Long Straight, Support, Long Straight, Support, Long Straight, Support, Long Straight, Support, Long Straight, Support, Long Straight, Support, Long Straight, Curved (begin corner), Long Straight, Curved (end corner), Support, Medium Straight, Support.",
                                        "The east corner will need to be pulled forward to both line up with the yellow line and close the gap when you begin to lay down the black pads.",
                                        "On the west end, a Curved piece should go against the wall, followed by a Support and Long Straight piece.",
                                        "After you have the west end white pieces in place, lay the black foam boards from west to east. It's easier to pull the east boards forward to close the gap.",
                                    ].map((step, i) => (
                                        <li key={i} className="flex gap-3">
                                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-primary">{i + 1}</span>
                                            <span>{step}</span>
                                        </li>
                                    ))}
                                </ol>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="p-5">
                                <h3 className="text-sm font-bold uppercase tracking-wider text-foreground mb-3">The Poles</h3>
                                <p className="text-sm text-muted-foreground mb-3">
                                    Next, put up the poles. There are 11 poles, 3 are slightly shorter due to cracked ends. They are placed on the eastern end:
                                </p>
                                <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground pl-1">
                                    <li>Start from the wall, first pole in with a 2-hole gap from the wall.</li>
                                    <li>One in each curved piece.</li>
                                    <li>The last five spaced out evenly behind the goal with 4–5 holes between them.</li>
                                </ul>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="p-5">
                                <h3 className="text-sm font-bold uppercase tracking-wider text-foreground mb-3">The Netting</h3>
                                <p className="text-sm text-muted-foreground mb-3">Next, put up the netting:</p>
                                <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground pl-1">
                                    <li>The edge of the net should have a bungee cord which can be used to tie to the fence along the sidewalk.</li>
                                    <li>Make sure it&apos;s not too high — the other end has loose strings to tie to the Corner white board piece.</li>
                                    <li>String the net along the top of the poles as best you can.</li>
                                    <li>Secure the netting in the white board pieces with the thin white poles.</li>
                                </ul>
                                <div className="mt-4 rounded-md bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-3 text-sm text-destructive font-medium">
                                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                                    <p>People should not be shooting while you are putting up the net.</p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Shed Tab */}
                {activeTab === "shed" && (
                    <div className="space-y-4 animate-in fade-in duration-300">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <Card className="bg-chart-2/5 border-chart-2/20">
                                <CardContent className="p-5">
                                    <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground mb-3">
                                        <CheckCircle className="h-4 w-4 text-chart-3" /> In the Shed
                                    </h3>
                                    <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground">
                                        <li>White plastic border patrols</li>
                                        <li>Black foam border guards</li>
                                        <li>Both nets</li>
                                        <li>PVC poles</li>
                                        <li>Thin long white plastic poles</li>
                                        <li>Black plastic tote for balls</li>
                                        <li>Transparent tote for first aid, whistles, rule book</li>
                                        <li>Two goal bags of extra gear + extra pads</li>
                                        <li>Brooms, rake, dust pan</li>
                                        <li>Trader Joe&apos;s bag (PCV hooks, Ref jerseys)</li>
                                    </ul>
                                </CardContent>
                            </Card>
                            <Card className="bg-destructive/5 border-destructive/20">
                                <CardContent className="p-5">
                                    <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-destructive mb-3">
                                        <X className="h-4 w-4" /> DO NOT put in Shed
                                    </h3>
                                    <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground">
                                        <li>Personal gear</li>
                                        <li>Trash</li>
                                        <li>Broken sticks</li>
                                        <li>Booze</li>
                                    </ul>
                                </CardContent>
                            </Card>
                        </div>

                        <p className="text-xs text-muted-foreground italic font-medium mb-2">
                            If there is water in any of the white boards (rare), please drain before loading into the shed.
                        </p>

                        {[
                            {
                                title: "1. Long Flat Boards & Curved/Corner",
                                description: "The 9 long white plastic boards go in first. They lie flat, pushed against the back wall and to the left. Link the indentions together. The 3 curved and single corner white boards go above these long flat boards.",
                                images: ["/images/howto/shed-1-longboards.jpg", "/images/howto/shed-1b-longboards.jpg", "/images/howto/shed-1c-longboards.jpg", "/images/howto/shed-2-curved.jpg"],
                            },
                            {
                                title: "2. Four Support Boards & Poles",
                                description: "Place 4 white support boards with the rink side facing against the long boards. Push to the left. PVC poles and thin white poles go on the floor to the right. The medium length straight board goes on top of the poles.",
                                images: ["/images/howto/shed-4-supports.jpg", "/images/howto/shed-3-poles.jpg"],
                            },
                            {
                                title: "3. Secondary Support Boards & Goalie Gear",
                                description: "Place 4 white support boards facing the other direction, linked together to maximize space. Fill in the gaps with the goalie pads and gear.",
                                images: ["/images/howto/shed-5-goalie.png"],
                            },
                            {
                                title: "4. Black Pads & Final Support Boards",
                                description: "Load 2 rows of black pads above the support pads and goalie gear. Put in the final 2 support white boards against the wall with the doors, one to each side.",
                                images: ["/images/howto/shed-6-blackpads.png", "/images/howto/shed-7-finalsupports.png"],
                            },
                            {
                                title: "5. Nets, Totes, and Final Check",
                                description: "You should have enough space between the 2 support boards for the nets and remaining gear. Make sure the nets have been folded (pins reinserted). The totes go below the nets. Check the playground for left items and lock the doors.",
                                images: ["/images/howto/shed-8-nets.png", "/images/howto/shed-nets-folding.png"],
                            },
                        ].map((step) => (
                            <Card key={step.title}>
                                <CardContent className="p-5">
                                    <h3 className="text-sm font-bold text-foreground mb-2">{step.title}</h3>
                                    <p className="text-sm text-muted-foreground mb-4">{step.description}</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {step.images.map((src) => (
                                            <Image
                                                key={src}
                                                src={src}
                                                alt={step.title}
                                                width={400}
                                                height={300}
                                                className="rounded-md border border-border w-full h-auto object-cover"
                                            />
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                {/* Footer */}
                <div className="mt-12 text-center">
                    <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
                        <HelpCircle className="h-4 w-4" />
                        Questions?{" "}
                        <a
                            href="mailto:sf.bash.hockey@gmail.com"
                            className="font-semibold text-primary hover:underline"
                        >
                            sf.bash.hockey@gmail.com
                        </a>
                    </p>
                </div>
            </main>
        </div>
    )
}
