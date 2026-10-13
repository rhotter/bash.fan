"use client"

import { useState } from "react"
import Image from "next/image"
import { AlertTriangle, ArrowUpRight } from "lucide-react"

const TABS = [
    { id: "boards" as const, label: "Assembling the Boards" },
    { id: "shed" as const, label: "Packing the Shed" },
] as const

type TabId = (typeof TABS)[number]["id"]

export default function HowToPage() {
    const [activeTab, setActiveTab] = useState<TabId>("boards")

    return (
        <div className="flex flex-1 flex-col bg-background">
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 md:py-16">
                {/* Hero */}
                <section className="mb-12 text-center">
                    <h1 className="mb-5 text-4xl md:text-6xl font-bold tracking-tighter leading-[0.95] text-foreground">
                        <span className="text-primary">How-To.</span>
                    </h1>
                    <p className="mx-auto max-w-xl text-[15px] md:text-base leading-relaxed text-muted-foreground">
                        Essential guides for community members. Since BASH is entirely volunteer-run, we rely on everyone to pitch in with setup and breakdown.
                    </p>
                </section>

                {/* Tabs */}
                <div className="mb-10 grid grid-cols-2 border-y border-border">
                    {TABS.map((tab) => {
                        const isActive = activeTab === tab.id
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={
                                    "group relative flex items-center justify-center py-4 transition-colors " +
                                    (isActive ? "text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground")
                                }
                            >
                                <span className="text-sm md:text-base font-bold tracking-tight">
                                    {tab.label}
                                </span>
                                {isActive && (
                                    <span className="absolute inset-x-0 -bottom-px h-[2px] bg-primary" />
                                )}
                            </button>
                        )
                    })}
                </div>

                {activeTab === "boards" && <BoardsTab />}
                {activeTab === "shed" && <ShedTab />}

                {/* Footer */}
                <div className="mt-16 border-t border-border pt-8 text-center">
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Questions?</div>
                    <a
                        href="mailto:sf.bash.hockey@gmail.com"
                        className="group inline-flex items-center gap-1.5 text-sm font-bold tracking-tight text-foreground hover:text-primary"
                    >
                        sf.bash.hockey@gmail.com
                        <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </a>
                </div>
            </main>
        </div>
    )
}

function BoardsTab() {
    return (
        <div className="animate-in fade-in space-y-12 duration-300">
            <div className="overflow-hidden rounded-xl border border-border bg-secondary/40">
                <Image
                    src="/images/howto/assemble-1-header.png"
                    alt="How to Assemble the Boards"
                    width={1000}
                    height={500}
                    sizes="(min-width: 1024px) 992px, calc(100vw - 32px)"
                    className="mx-auto h-auto w-full object-contain"
                />
            </div>

            <SectionBlock title="First Steps">
                <p className="mb-3 text-sm md:text-[15px] leading-relaxed text-muted-foreground">
                    Look around, is the rink ready? Are you a goalie? No: then pitch in and help. Either with the boards, nets, sweeping, or netting.
                </p>
                <Callout>
                    Is the rink still not ready? Do not shoot at the east end until the netting is finished. Your fellow BASHers are working to get the rink ready.
                </Callout>
            </SectionBlock>

            <SectionBlock title="The Boards">
                <p className="mb-2 text-sm md:text-[15px] leading-relaxed text-muted-foreground">
                    There are <Stat>24</Stat> total white board pieces: <Stat>10</Stat> Support, <Stat>9</Stat> Straight Long, <Stat>3</Stat> Curved, <Stat>1</Stat> Straight Medium, and <Stat>1</Stat> Corner.
                </p>
                <p className="mb-6 text-sm md:text-[15px] font-medium text-foreground">
                    Start on the east end closest to the shed.
                </p>
                <ol className="space-y-4 border-t border-border pt-6">
                    {[
                        "Place the one corner piece next to where the benches stop.",
                        "Building out from the wall: Support, Long Straight, Support, Long Straight, Support, Long Straight, Support, Long Straight, Support, Long Straight, Support, Long Straight, Support, Long Straight, Curved (begin corner), Long Straight, Curved (end corner), Support, Medium Straight, Support.",
                        "The east corner will need to be pulled forward to both line up with the yellow line and close the gap when you begin to lay down the black pads.",
                        "On the west end, a Curved piece should go against the wall, followed by a Support and Long Straight piece.",
                        "After you have the west end white pieces in place, lay the black foam boards from west to east. It's easier to pull the east boards forward to close the gap.",
                    ].map((step, i) => (
                        <li key={i} className="flex gap-4">
                            <span className="font-mono text-sm font-bold tabular-nums text-primary leading-relaxed">
                                {i + 1}.
                            </span>
                            <span className="text-sm md:text-[15px] leading-relaxed text-muted-foreground">{step}</span>
                        </li>
                    ))}
                </ol>
            </SectionBlock>

            <SectionBlock title="The Poles">
                <p className="mb-4 text-sm md:text-[15px] leading-relaxed text-muted-foreground">
                    Next, put up the poles. There are <Stat>11</Stat> poles, <Stat>3</Stat> are slightly shorter due to cracked ends. They are placed on the eastern end:
                </p>
                <BulletList
                    items={[
                        "Start from the wall, first pole in with a 2-hole gap from the wall.",
                        "One in each curved piece.",
                        "The last five spaced out evenly behind the goal with 4–5 holes between them.",
                    ]}
                />
            </SectionBlock>

            <SectionBlock title="The Netting">
                <p className="mb-4 text-sm md:text-[15px] leading-relaxed text-muted-foreground">
                    Next, put up the netting:
                </p>
                <BulletList
                    items={[
                        "The edge of the net should have a bungee cord which can be used to tie to the fence along the sidewalk.",
                        "Make sure it's not too high — the other end has loose strings to tie to the Corner white board piece.",
                        "String the net along the top of the poles as best you can.",
                        "Secure the netting in the white board pieces with the thin white poles.",
                    ]}
                />
                <div className="mt-6">
                    <Callout>
                        People should not be shooting while you are putting up the net.
                    </Callout>
                </div>
            </SectionBlock>
        </div>
    )
}

function ShedTab() {
    return (
        <div className="animate-in fade-in space-y-12 duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
                <div className="bg-card p-6">
                    <div className="mb-4">
                        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">In the Shed</span>
                    </div>
                    <ul className="space-y-2 text-sm text-foreground">
                        {[
                            "White plastic border patrols",
                            "Black foam border guards",
                            "Both nets",
                            "PVC poles",
                            "Thin long white plastic poles",
                            "Black plastic tote for balls",
                            "Transparent tote for first aid, whistles, rule book",
                            "Two goal bags of extra gear + extra pads",
                            "Brooms, rake, dust pan",
                            "Trader Joe's bag (PVC hooks, Ref jerseys)",
                        ].map((item) => (
                            <li key={item} className="flex items-baseline gap-3">
                                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary" />
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="bg-card p-6">
                    <div className="mb-4">
                        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Do Not Put In Shed</span>
                    </div>
                    <ul className="space-y-2 text-sm text-foreground">
                        {["Personal gear", "Trash", "Broken sticks", "Booze"].map((item) => (
                            <li key={item} className="flex items-baseline gap-3">
                                <span className="font-mono text-muted-foreground">×</span>
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            <p className="font-mono text-[11px] italic text-muted-foreground">
                ▸ If there is water in any of the white boards (rare), please drain before loading into the shed.
            </p>

            <div className="space-y-12">
                {[
                    {
                        title: "Long Flat Boards & Curved/Corner",
                        description: "The 9 long white plastic boards go in first. They lie flat, pushed against the back wall and to the left. Link the indentions together. The 3 curved and single corner white boards go above these long flat boards.",
                        images: ["/images/howto/shed-1-longboards.jpg", "/images/howto/shed-1b-longboards.jpg", "/images/howto/shed-1c-longboards.jpg", "/images/howto/shed-2-curved.jpg"],
                    },
                    {
                        title: "Four Support Boards & Poles",
                        description: "Place 4 white support boards with the rink side facing against the long boards. Push to the left. PVC poles and thin white poles go on the floor to the right. The medium length straight board goes on top of the poles.",
                        images: ["/images/howto/shed-4-supports.jpg", "/images/howto/shed-3-poles.jpg"],
                    },
                    {
                        title: "Secondary Support Boards & Goalie Gear",
                        description: "Place 4 white support boards facing the other direction, linked together to maximize space. Fill in the gaps with the goalie pads and gear.",
                        images: ["/images/howto/shed-5-goalie.png"],
                    },
                    {
                        title: "Black Pads & Final Support Boards",
                        description: "Load 2 rows of black pads above the support pads and goalie gear. Put in the final 2 support white boards against the wall with the doors, one to each side.",
                        images: ["/images/howto/shed-6-blackpads.png", "/images/howto/shed-7-finalsupports.png"],
                    },
                    {
                        title: "Nets, Totes, and Final Check",
                        description: "You should have enough space between the 2 support boards for the nets and remaining gear. Make sure the nets have been folded (pins reinserted). The totes go below the nets. Check the playground for left items and lock the doors.",
                        images: ["/images/howto/shed-8-nets.png", "/images/howto/shed-nets-folding.png"],
                    },
                ].map((step) => (
                    <SectionBlock key={step.title} title={step.title}>
                        <p className="mb-5 text-sm md:text-[15px] leading-relaxed text-muted-foreground">
                            {step.description}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {step.images.map((src) => (
                                <div key={src} className="overflow-hidden rounded-lg border border-border bg-secondary/40">
                                    <Image
                                        src={src}
                                        alt={step.title}
                                        width={400}
                                        height={300}
                                        sizes="(min-width: 1024px) 490px, (min-width: 640px) calc((100vw - 44px) / 2), calc(100vw - 32px)"
                                        className="h-auto w-full object-cover"
                                    />
                                </div>
                            ))}
                        </div>
                    </SectionBlock>
                ))}
            </div>
        </div>
    )
}

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section>
            <div className="mb-5 flex items-baseline gap-3">
                <h2 className="text-lg md:text-xl font-bold tracking-tight text-foreground">{title}</h2>
                <div className="h-px flex-1 bg-border" />
            </div>
            {children}
        </section>
    )
}

function BulletList({ items }: { items: string[] }) {
    return (
        <ul className="space-y-2.5">
            {items.map((item, i) => (
                <li key={i} className="flex gap-3 text-sm md:text-[15px] leading-relaxed text-muted-foreground">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
                    <span>{item}</span>
                </li>
            ))}
        </ul>
    )
}

function Callout({ children }: { children: React.ReactNode }) {
    return (
        <div className="rounded-lg border-l-2 border-destructive bg-destructive/5 px-4 py-3">
            <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-destructive">
                <AlertTriangle className="h-3 w-3" />
                Important
            </div>
            <p className="text-sm leading-relaxed text-foreground">{children}</p>
        </div>
    )
}

function Stat({ children }: { children: React.ReactNode }) {
    return <span className="font-mono text-sm font-bold tabular-nums text-foreground">{children}</span>
}
