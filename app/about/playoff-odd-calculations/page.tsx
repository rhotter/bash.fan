import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, ArrowUpRight, BookOpen } from "lucide-react"
import { BASH_CALIBRATION } from "@/lib/playoff-odds"

export const metadata: Metadata = {
  title: "How BASH Calculates Playoff Odds | Methodology",
  description:
    "A reproducible technical walkthrough of Bay Area Street Hockey's Monte Carlo playoff odds engine — equations, workflow, empirical calibration across 2,126 BASH games, and primary sources.",
}

const TOC_ITEMS = [
  { id: "lineage", label: "1. Standing on Sports Club Stats's shoulders" },
  { id: "model-comparison", label: "2. Model comparison at a glance" },
  { id: "workflow", label: "3. End-to-end simulation workflow" },
  { id: "models", label: "4. Team strength models & equations" },
  { id: "outcomes", label: "5. From ratings to 6 game outcomes" },
  { id: "rules", label: "6. BASH rules, tiebreakers & max-flow guardrails" },
  { id: "calibration", label: "7. Empirical calibration & LOSO validation" },
  { id: "big-games", label: "8. Big Games, What-If & noise hygiene" },
  { id: "references", label: "9. References, archives & further reading" },
] as const

const CONCEPT_URLS = {
  monteCarlo: "https://en.wikipedia.org/wiki/Monte_Carlo_method",
  gammaPoisson: "https://en.wikipedia.org/wiki/Conjugate_prior",
  pythagenPuck: "https://web.archive.org/web/20240411005554/http://www.hockeyanalytics.com/Research_files/Win_Probabilities.pdf",
  empiricalBayes: "https://en.wikipedia.org/wiki/Empirical_Bayes_method",
  betaDist: "https://en.wikipedia.org/wiki/Beta_distribution",
  marsagliaTsang: "https://en.wikipedia.org/wiki/Gamma_distribution#Random_variate_generation",
  log5: "https://en.wikipedia.org/wiki/Log5",
  fnv1a: "https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function",
  xoshiro: "https://en.wikipedia.org/wiki/Xorshift#xoshiro_and_xoroshiro",
  edmondsKarp: "https://en.wikipedia.org/wiki/Edmonds%E2%80%93Karp_algorithm",
  overdispersion: "https://en.wikipedia.org/wiki/Overdispersion",
  crossValidation: "https://en.wikipedia.org/wiki/Cross-validation_(statistics)",
  rps: "https://en.wikipedia.org/wiki/Scoring_rule#Ranked_probability_score",
  brier: "https://en.wikipedia.org/wiki/Brier_score",
  blockBootstrap: "https://en.wikipedia.org/wiki/Bootstrapping_(statistics)#Block_bootstrap",
  zTest: "https://en.wikipedia.org/wiki/Z-test",
  scsP225: "https://web.archive.org/web/20150405212459/http://blog.sportsclubstats.com/?p=225",
  scsP270: "https://web.archive.org/web/20150405203426/http://blog.sportsclubstats.com/?p=270",
} as const

const WORKFLOW_STEPS: ReadonlyArray<{ step: string; title: string; body: React.ReactNode }> = [
  {
    step: "01",
    title: "Parse regular-season schedule, boxscore headcounts & clean goal tallies",
    body: "Load all regular-season games (filtering out playoffs and exhibitions) along with dressed boxscore headcounts (distinct player_id union across skaters and goalies). Apply BASH 3-2-1 scoring, historical non-forfeit ties (1 pt each), and Rule 208 forfeits (5–0 / 0–5). Strip shootout winning goals (SOWG) and forfeit scores from open-play goal rates so administrative forfeits and shootout tiebreakers never distort team strength.",
  },
  {
    step: "02",
    title: "Compute point-estimate team ratings",
    body: (
      <>
        Calculate each team&apos;s base rating S ∈ [0.05, 0.95] for the selected model: BASH Weighted (pre-ratio{" "}
        <ConceptLink href={CONCEPT_URLS.gammaPoisson}>Gamma-Poisson goal shrinkage</ConceptLink> →{" "}
        <ConceptLink href={CONCEPT_URLS.pythagenPuck}>PythagenPuck</ConceptLink> →{" "}
        <ConceptLink href={CONCEPT_URLS.empiricalBayes}>Empirical Bayes shrinkage</ConceptLink>), BASH Full-Strength
        Adj (the same pipeline after symmetrically de-attending each game&apos;s goals to even headcounts), 50/50
        (fixed 0.500), or SCS Classic (PTS / (3 × GP) with{" "}
        <ConceptLink href={CONCEPT_URLS.scsP225}>Ken Roberts&apos;s piecewise regression curve</ConceptLink>).
      </>
    ),
  },
  {
    step: "03",
    title: "Lock in a reproducible random seed",
    body: (
      <>
        Turn the current schedule, scores, and model choice into a fixed starting seed for the simulator&apos;s
        random-number generator — like shuffling a deck of cards the exact same way every time until a new game is
        finalized. That guarantees odds never bounce around on page refresh and stay bit-for-bit reproducible from the
        same scores{" "}
        <span className="text-muted-foreground/80">
          (implementation detail: we fingerprint the sorted schedule with{" "}
          <ConceptLink href={CONCEPT_URLS.fnv1a}>FNV-1a</ConceptLink> and seed a fast{" "}
          <ConceptLink href={CONCEPT_URLS.xoshiro}>xoshiro128**</ConceptLink> generator).
        </span>
      </>
    ),
  },
  {
    step: "04",
    title: "Simulate 100,000 seasons (20,000 in client What-If)",
    body: (
      <>
        In each <ConceptLink href={CONCEPT_URLS.monteCarlo}>Monte Carlo</ConceptLink> season, draw team strength θ from
        a <ConceptLink href={CONCEPT_URLS.betaDist}>Beta posterior</ConceptLink> (BASH Weighted and BASH Full-Strength Adj), pair
        remaining matchups via <ConceptLink href={CONCEPT_URLS.log5}>Bill James Log5</ConceptLink>, apply normalized
        extra-time probabilities and 3-2-1 decompression, sample one of 6 outcomes plus an empirical goal margin, and
        rank final standings using official BASH Rule 213 tiebreakers.
      </>
    ),
  },
  {
    step: "05",
    title: "Single-pass Big Games, isolated tail probes & max-flow guardrails",
    body: (
      <>
        Accumulate Big Games conditional odds inside the exact same 100,000-iteration loop (zero strength drift), run
        isolated 1,000-run win-out/lose-out tail probes for rare What-If finish rows, and verify mathematical clinches
        (In) and eliminations (Out) via <ConceptLink href={CONCEPT_URLS.edmondsKarp}>Edmonds–Karp max-flow</ConceptLink>.
      </>
    ),
  },
  {
    step: "06",
    title: "Deterministic historical matchday replay",
    body: "Replay every completed matchday chronologically (10,000 runs for older dates, 100,000 for the immediately preceding matchday to prevent bye-week delta jitter) to generate the season trend charts and matchday-over-matchday change badges on demand.",
  },
]

const CALIBRATION_COMPARISON = [
  {
    param: "Home-ice advantage (HFA)",
    fall: "0.50 (49.3% empirical)",
    summer: "0.50 (49.5% empirical)",
    nhl: "0.54–0.56",
  },
  {
    param: "Mean goals / team-game (no SOWG)",
    fall: `${BASH_CALIBRATION.fall.leagueMeanGoalsPerTeam} (~7.5 total/game)`,
    summer: `${BASH_CALIBRATION.summer.leagueMeanGoalsPerTeam} (~12.3 total/game)`,
    nhl: "~2.8–3.1 (~5.8 total)",
  },
  {
    param: "Goal overdispersion (var / mean)",
    fall: "1.63",
    summer: "1.60",
    nhl: "~1.05–1.15",
  },
  {
    param: "OT + Shootout target rate",
    fall: "12.0% (7.5% OT / 4.5% SO)",
    summer: "9.0% (5.5% OT / 3.5% SO)",
    nhl: "~24.4% (12.0% / 12.4%)",
  },
  {
    param: "Pre-ratio goal prior (m)",
    fall: `${BASH_CALIBRATION.fall.goalPriorGames} games`,
    summer: `${BASH_CALIBRATION.summer.goalPriorGames} games`,
    nhl: "None (Laplace)",
  },
  {
    param: "PythagenPuck power (P)",
    fall: `${BASH_CALIBRATION.fall.pythagenPuckPower}`,
    summer: `${BASH_CALIBRATION.summer.pythagenPuckPower}`,
    nhl: "0.458",
  },
  {
    param: "Post-ratio EB shrinkage (C)",
    fall: `${BASH_CALIBRATION.fall.ebShrinkageGames} games`,
    summer: `${BASH_CALIBRATION.summer.ebShrinkageGames} games`,
    nhl: "Piecewise p225",
  },
  {
    param: "Bayesian Beta concentration (k)",
    fall: `${BASH_CALIBRATION.fall.strengthConcentration} (84.9% / 91.9% cov., PIT 0.0833)`,
    summer: `${BASH_CALIBRATION.summer.strengthConcentration} (82.7% / 92.0% cov.)`,
    nhl: "Plug-in (k = 0)",
  },
  {
    param: "Regulation / OT loser goals",
    fall: `${BASH_CALIBRATION.fall.regLoserGoals} reg / ${BASH_CALIBRATION.fall.otLoserGoals} OT`,
    summer: `${BASH_CALIBRATION.summer.regLoserGoals} reg / ${BASH_CALIBRATION.summer.otLoserGoals} OT`,
    nhl: "~1.8 / ~2.5",
  },
  {
    param: "Attendance 20th / 50th / 80th (dressed)",
    fall: `${BASH_CALIBRATION.fall.attendance.lowP20} / ${BASH_CALIBRATION.fall.attendance.medianP50} / ${BASH_CALIBRATION.fall.attendance.highP80}`,
    summer: `${BASH_CALIBRATION.summer.attendance.lowP20} / ${BASH_CALIBRATION.summer.attendance.medianP50} / ${BASH_CALIBRATION.summer.attendance.highP80}`,
    nhl: "Fixed roster",
  },
  {
    param: "Attendance goal-diff / log-odds slope",
    fall: `${BASH_CALIBRATION.fall.attendance.goalDiffSlope} / ${BASH_CALIBRATION.fall.attendance.logOddsSlope}`,
    summer: `${BASH_CALIBRATION.summer.attendance.goalDiffSlope} / ${BASH_CALIBRATION.summer.attendance.logOddsSlope}`,
    nhl: "N/A",
  },
] as const

const LOSO_RESULTS = [
  {
    model: "BASH Weighted (Decompressed, P, C, m)",
    fallRps: "0.23515",
    fallRmse: "1.3690",
    fallBrier: "0.23832",
    summerRps: "0.23598",
    summerRmse: "1.3941",
    summerBrier: "0.23593",
    highlight: true,
  },
  {
    model: "BASH Weighted (Post-ratio only, m = 0)",
    fallRps: "0.23536",
    fallRmse: "1.3697",
    fallBrier: "0.23853",
    summerRps: "0.23649",
    summerRmse: "1.3957",
    summerBrier: "0.23645",
    highlight: false,
  },
  {
    model: "EB Shrunk Points % (nested C)",
    fallRps: "0.23660",
    fallRmse: "1.3737",
    fallBrier: "0.23956",
    summerRps: "0.24074",
    summerRmse: "1.4095",
    summerBrier: "0.24119",
    highlight: false,
  },
  {
    model: "SCS Classic (Ken p225 regression)",
    fallRps: "0.23951",
    fallRmse: "1.3826",
    fallBrier: "0.24239",
    summerRps: "0.25636",
    summerRmse: "1.4582",
    summerBrier: "0.25521",
    highlight: false,
  },
  {
    model: "50/50 Coin Flip",
    fallRps: "0.24703",
    fallRmse: "1.4078",
    fallBrier: "0.25000",
    summerRps: "0.24857",
    summerRmse: "1.4343",
    summerBrier: "0.25000",
    highlight: false,
  },
] as const

const COVERAGE_RESULTS = [
  {
    k: "k = 0 (Plug-in, no Beta sampling)",
    fall80: "71.2%",
    fall90: "83.2%",
    summer80: "79.1%",
    summer90: "90.2%",
    note: "Under-covers in Fall (overconfident)",
  },
  {
    k: "k = 1",
    fall80: "86.2%",
    fall90: "91.8%",
    summer80: "86.7%",
    summer90: "94.7%",
    note: "Slightly wide",
  },
  {
    k: "k = 1.5 (Fall default)",
    fall80: "84.9%",
    fall90: "91.9%",
    summer80: "85.5%",
    summer90: "94.0%",
    note: "Best Fall CRPS & ideal PIT variance (0.0833)",
  },
  {
    k: "k = 2",
    fall80: "81.6%",
    fall90: "91.9%",
    summer80: "83.8%",
    summer90: "93.2%",
    note: "Slightly under-dispersed in Fall (PIT 0.090)",
  },
  {
    k: "k = 3 (Summer default)",
    fall80: "78.8%",
    fall90: "88.2%",
    summer80: "82.7%",
    summer90: "92.0%",
    note: "Calibrated for short Summer schedules",
  },
] as const

const REFERENCES = [
  {
    category: "Sports Club Stats Archives (Ken Roberts)",
    items: [
      {
        title: "Archived 2018–19 BASH Playoff Odds (Weighted)",
        href: "https://web.archive.org/web/20190227120431/http://www.sportsclubstats.com/you/bayareastreethockey.html",
        detail:
          "Wayback Machine capture (Feb 2019) of BASH's actual league page on Sports Club Stats — used as our historical parity benchmark.",
      },
      {
        title: "Archived 2018–19 BASH Playoff Odds (50/50 Mode)",
        href: "https://web.archive.org/web/20190221031638/http://www.sportsclubstats.com/You/BayAreaStreetHockey2.html",
        detail: "The unbiased coin-flip companion page isolating pure schedule and standings math.",
      },
      {
        title: "Archived BASH League Config File (BayAreaStreetHockey.txt)",
        href: "https://web.archive.org/web/20190227/http://www.sportsclubstats.com/You/BayAreaStreetHockey.txt",
        detail: "The plain-text DSL schedule and rules file BASH originally submitted to Sports Club Stats.",
      },
      {
        title: "Sports Club Stats — \"What Is This?\" Methodology Explainer",
        href: "https://web.archive.org/web/20240415030615/http://www.sportsclubstats.com/WhatIsThis.html",
        detail: "Ken Roberts's original overview of weighted simulations, Log5, and PythagenPuck.",
      },
      {
        title: "Ken Roberts's Sports Club Stats League Format Google Doc",
        href: "https://docs.google.com/document/d/1-UneDNk6tkOrc_B-WBnGnc5KGiy2kttXC2fW8dR7QzM/edit?hl=en",
        detail: "Full specification of WeightType, tiebreaker sorting blocks, and shootout-goal handling.",
      },
      {
        title: "Sports Club Stats Engineering Blog Archive (2007–2013)",
        href: "https://web.archive.org/web/20140929163803/http://blog.sportsclubstats.com/",
        detail:
          "Primary source for Ken's p225 regression formula, single-pass Big Games breakthrough (#10964), isolated tail probes (#10674), and the 2009 Senators elimination lesson (p270).",
      },
    ],
  },
  {
    category: "Foundational Statistical Papers",
    items: [
      {
        title: "Alan Ryder (2004) — Win Probabilities (PDF, Archive)",
        href: "https://web.archive.org/web/20240411005554/http://www.hockeyanalytics.com/Research_files/Win_Probabilities.pdf",
        detail:
          "Derives Generalized Pythagoras and PythagenPuck from competing Poisson processes and explains why higher scoring variance lowers the optimal power P.",
      },
      {
        title: "Alan Ryder (2004) — Poisson Toolbox (PDF, Archive)",
        href: "https://web.archive.org/web/20210506074300/http://www.hockeyanalytics.com/Research_files/Poisson_Toolbox.pdf",
        detail:
          "Skellam margin probabilities, head-to-head scoring intensities, and sudden-death overtime dynamics in hockey.",
      },
      {
        title: "Tom Tippett (2002) — \"May the Best Team Win… at Least Some of the Time\" (Archive)",
        href: "https://web.archive.org/web/20150418070648/http://207.56.97.150/articles/playoff2002.htm",
        detail:
          "Diamond Mind Baseball's classic exposition of Bill James's Log5 matchup formula and Monte Carlo playoff simulation caveats.",
      },
    ],
  },
] as const

export default function PlayoffOddCalculationsPage() {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12">
        {/* Back link */}
        <div className="mb-8">
          <Link
            href="/standings?view=odds"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Playoff Odds
          </Link>
        </div>

        <article className="space-y-12 text-[15px] leading-[1.7] text-muted-foreground">
          {/* Article Header */}
          <header className="space-y-4 border-b border-border pb-8">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5 text-foreground/70" />
              <span>BASH Analytics · Methodology &amp; Reproducibility</span>
            </div>
            <h1 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              How BASH calculates playoff odds
            </h1>
            <p className="max-w-[65ch] text-pretty text-base leading-relaxed text-muted-foreground">
              A complete technical guide to the statistical models, equations, empirical calibration, and tiebreaker
              rules behind our playoff odds simulator — written so anyone with BASH game scores can reproduce our
              numbers from scratch.
            </p>
            <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
              <span className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 tabular-nums">
                100,000 Monte Carlo runs
              </span>
              <span className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 tabular-nums">
                2,126 historical BASH games
              </span>
              <span className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5">
                4 simulation models
              </span>
              <span className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5">
                Deterministic seeded replay
              </span>
            </div>
          </header>

          {/* Table of Contents */}
          <nav
            aria-label="On this page"
            className="rounded-xl border border-border bg-card/60 p-5"
          >
            <h2 className="mb-3 text-xs font-semibold text-foreground">On this page</h2>
            <ol className="grid gap-1.5 text-sm sm:grid-cols-2">
              {TOC_ITEMS.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="text-muted-foreground transition-colors hover:text-foreground hover:underline underline-offset-4"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* Section 1: Lineage */}
          <section id="lineage" className="scroll-mt-20 space-y-4">
            <ArticleHeading number="01" title="Standing on Sports Club Stats's shoulders" />
            <p className="max-w-[68ch] text-pretty">
              Credit where credit is due: our methodology is an evolution of{" "}
              <strong className="font-semibold text-foreground">www.sportsclubstats.com</strong> (now defunct), built
              by Ken Roberts. For years, BASH players and captains checked our league&apos;s Sports Club Stats page
              every Saturday afternoon to see playoff odds, seed grids, and &ldquo;Who should we root for?&rdquo;
              tables.
            </p>
            <p className="max-w-[68ch] text-pretty">
              Before writing our own engine, we pulled archived snapshots of BASH&apos;s 2018–19 Sports Club Stats
              page, Ken&apos;s plain-text league DSL specification, and his 2007–2013 engineering blog from the
              Internet Archive. Running our reconstruction of Ken&apos;s model on our historical game data reproduced
              both team strengths and playoff odds from the{" "}
              <ConceptLink href="https://web.archive.org/web/20190227120431/http://www.sportsclubstats.com/you/bayareastreethockey.html">
                last year we used the site (2019)
              </ConceptLink>
              .
            </p>
            <p className="max-w-[68ch] text-pretty">
              With the new site and our historic BASH data, we were able to build a new default model (
              <strong className="font-semibold text-foreground">BASH Weighted</strong>) calibrated empirically to our
              league&apos;s outdoor 5v5 Fall and 4v4 Summer hockey data, plus{" "}
              <strong className="font-semibold text-foreground">BASH Full-Strength Adj</strong> (adjusting goal rates
              for game-by-game bench attendance). We also included{" "}
              <strong className="font-semibold text-foreground">50/50</strong> and{" "}
              <strong className="font-semibold text-foreground">SCS Classic</strong> (based on the original Sports Club
              Stats methodology) as switchable modes so folks can compare alternative views of playoff probabilities.
            </p>
          </section>

          {/* Section 2: Model Comparison at a Glance */}
          <section id="model-comparison" className="scroll-mt-20 space-y-5">
            <ArticleHeading number="02" title="Model comparison at a glance" />
            <p className="max-w-[68ch] text-pretty">
              All four models run the exact same 100,000-season Monte Carlo schedule engine, OT/SO rates, and BASH Rule
              213 tiebreakers — they differ only in how each team&apos;s win strength is estimated before simulating the
              remaining games.
            </p>
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[620px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                    <th scope="col" className="px-3.5 py-2.5 font-semibold text-foreground">
                      Model
                    </th>
                    <th scope="col" className="px-3.5 py-2.5 font-semibold text-foreground">
                      Strength input
                    </th>
                    <th scope="col" className="px-3.5 py-2.5 font-semibold text-foreground">
                      Early-season uncertainty
                    </th>
                    <th scope="col" className="px-3.5 py-2.5 font-semibold text-foreground">
                      Best for
                    </th>
                    <th scope="col" className="px-3.5 py-2.5 font-semibold text-foreground">
                      vs. 50/50 (LOSO Brier)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  <tr className="bg-muted/20">
                    <th scope="row" className="px-3.5 py-3 align-top font-semibold text-foreground whitespace-nowrap">
                      BASH Weighted
                      <span className="ml-1.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Default
                      </span>
                    </th>
                    <td className="px-3.5 py-3 align-top text-muted-foreground">
                      Open-play GF / GA via PythagenPuck + Empirical Bayes shrinkage
                    </td>
                    <td className="px-3.5 py-3 align-top text-muted-foreground tabular-nums">
                      Beta draws (<code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">k = {BASH_CALIBRATION.fall.strengthConcentration}</code> Fall / <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">{BASH_CALIBRATION.summer.strengthConcentration}</code> Summer)
                    </td>
                    <td className="px-3.5 py-3 align-top text-muted-foreground">
                      Most accurate forecast of what will happen
                    </td>
                    <td className="px-3.5 py-3 align-top font-medium text-foreground tabular-nums">
                      −4.7% Fall · −5.6% Summer
                      <div className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                        Best pre-game baseline
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="px-3.5 py-3 align-top font-semibold text-foreground whitespace-nowrap">
                      BASH Full-Strength Adj
                    </th>
                    <td className="px-3.5 py-3 align-top text-muted-foreground">
                      Same as BASH Weighted, after de-attending past GF / GA to even headcounts
                    </td>
                    <td className="px-3.5 py-3 align-top text-muted-foreground tabular-nums">
                      Same Beta draws (<code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">k = {BASH_CALIBRATION.fall.strengthConcentration}</code> / <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">{BASH_CALIBRATION.summer.strengthConcentration}</code>)
                    </td>
                    <td className="px-3.5 py-3 align-top text-muted-foreground">
                      Separating roster talent from short or deep benches
                    </td>
                    <td className="px-3.5 py-3 align-top text-muted-foreground">
                      Even-bench counterfactual
                      <div className="mt-0.5 text-[11px] text-muted-foreground/90 tabular-nums">
                        −8.0% Fall / −7.8% Summer when game-day turnout is known
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="px-3.5 py-3 align-top font-semibold text-foreground whitespace-nowrap">
                      50/50
                    </th>
                    <td className="px-3.5 py-3 align-top text-muted-foreground">
                      Fixed <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">.500</code> for every team
                    </td>
                    <td className="px-3.5 py-3 align-top text-muted-foreground">None (coin flip)</td>
                    <td className="px-3.5 py-3 align-top text-muted-foreground">
                      Pure schedule &amp; standings math baseline
                    </td>
                    <td className="px-3.5 py-3 align-top text-muted-foreground tabular-nums">
                      Baseline (<code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">0.25000</code> · 50.0% acc.)
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="px-3.5 py-3 align-top font-semibold text-foreground whitespace-nowrap">
                      SCS Classic
                    </th>
                    <td className="px-3.5 py-3 align-top text-muted-foreground">
                      Points % (<code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">PTS / 3·GP</code>) + Ken&apos;s <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">p225</code> regression
                    </td>
                    <td className="px-3.5 py-3 align-top text-muted-foreground">None (fixed regressed strength)</td>
                    <td className="px-3.5 py-3 align-top text-muted-foreground">
                      Historical parity with Sports Club Stats
                    </td>
                    <td className="px-3.5 py-3 align-top text-muted-foreground tabular-nums">
                      −3.0% Fall · +2.1% worse Summer
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
              <p className="max-w-[68ch] text-pretty">
                <strong className="font-semibold text-foreground">
                  BASH Weighted vs. BASH Full-Strength Adj:
                </strong>{" "}
                Because a team&apos;s attendance habit tends to persist from week to week,{" "}
                <strong className="font-semibold text-foreground">BASH Weighted</strong> stays the default forecast of
                what is most likely to happen.{" "}
                <strong className="font-semibold text-foreground">BASH Full-Strength Adj</strong> strips bench-size
                advantage and disadvantage out of past scores to answer{" "}
                <em>&ldquo;how strong is each roster at even attendance?&rdquo;</em> — shifting odds upward for
                chronically short-benched teams and downward for unusually deep-benched teams.
              </p>
            </div>
          </section>

          {/* Section 3: Workflow */}
          <section id="workflow" className="scroll-mt-20 space-y-5">
            <ArticleHeading number="03" title="End-to-end simulation workflow" />
            <p className="max-w-[68ch] text-pretty">
              Every playoff odds snapshot runs through a pure, deterministic six-stage pipeline with no hidden state or
              manual adjustments. The exact same engine executes on the server (100,000 runs) and inside your browser
              when you lock hypothetical What-If picks (20,000 runs).
            </p>
            <ol className="space-y-3">
              {WORKFLOW_STEPS.map((item) => (
                <li
                  key={item.step}
                  className="rounded-xl border border-border bg-card p-4 sm:p-5"
                >
                  <div className="flex items-start gap-3.5">
                    <span className="mt-0.5 shrink-0 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-foreground">
                      {item.step}
                    </span>
                    <div className="min-w-0 space-y-1">
                      <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                      <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* Section 4: Models & Equations */}
          <section id="models" className="scroll-mt-20 space-y-6">
            <ArticleHeading number="04" title="Team strength models &amp; equations" />
            <p className="max-w-[68ch] text-pretty">
              Each model translates completed regular-season results into a team strength rating{" "}
              <Var>S</Var>
              <sub>i</sub> ∈ [0.05, 0.95] representing expected winning percentage against an average{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">.500</code> opponent.
            </p>

            {/* Model A: BASH Weighted */}
            <div className="space-y-4 rounded-xl border border-border bg-card p-5 sm:p-6">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">
                  A. BASH Weighted <span className="text-xs font-normal text-muted-foreground">(Default)</span>
                </h3>
                <p className="text-pretty text-sm text-muted-foreground">
                  Goals carry far more signal than wins and losses in short 10–18 game seasons. BASH Weighted estimates
                  team strength in four steps, using only non-forfeit games and stripping the artificial shootout
                  winning goal (SOWG) so a 4–3 shootout counts as 3–3 open-play goals.
                </p>
              </div>

              <FormulaCard
                label={
                  <>
                    1. Pre-ratio <ConceptLink href={CONCEPT_URLS.gammaPoisson}>Gamma-Poisson</ConceptLink> goal-rate
                    shrinkage
                  </>
                }
              >
                <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
                  <span>
                    <Var>GFg</Var>
                    <sub>i</sub> ={" "}
                    <Fraction
                      num={
                        <>
                          <Var>GF</Var>
                          <sub>i</sub> + <Var>m</Var> · <Var>μ</Var>
                        </>
                      }
                      den={
                        <>
                          <Var>GP</Var>
                          <sub>i</sub> + <Var>m</Var>
                        </>
                      }
                    />
                  </span>
                  <span>
                    <Var>GAg</Var>
                    <sub>i</sub> ={" "}
                    <Fraction
                      num={
                        <>
                          <Var>GA</Var>
                          <sub>i</sub> + <Var>m</Var> · <Var>μ</Var>
                        </>
                      }
                      den={
                        <>
                          <Var>GP</Var>
                          <sub>i</sub> + <Var>m</Var>
                        </>
                      }
                    />
                  </span>
                </div>
                <p className="mt-2.5 text-center text-xs text-muted-foreground">
                  <Var>m</Var> = 4 prior games toward league-average goals per team-game (<Var>μ</Var> = 3.73 Fall,
                  6.13 Summer). Cleanly eliminates early-season shutout singularities.
                </p>
              </FormulaCard>

              <FormulaCard
                label={
                  <>
                    2. BASH-calibrated <ConceptLink href={CONCEPT_URLS.pythagenPuck}>PythagenPuck</ConceptLink> expected
                    win %
                  </>
                }
              >
                <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
                  <span>
                    <Var>E</Var>
                    <sub>i</sub> = max(0.5, (<Var>GFg</Var>
                    <sub>i</sub> + <Var>GAg</Var>
                    <sub>i</sub>)
                    <sup>
                      <Var>P</Var>
                    </sup>
                    )
                  </span>
                  <span>
                    <Var>S</Var>
                    <sub>raw, i</sub> ={" "}
                    <Fraction
                      num={
                        <>
                          <Var>GFg</Var>
                          <sub>i</sub>
                          <sup>
                            <Var>E</Var>
                            <sub>i</sub>
                          </sup>
                        </>
                      }
                      den={
                        <>
                          <Var>GFg</Var>
                          <sub>i</sub>
                          <sup>
                            <Var>E</Var>
                            <sub>i</sub>
                          </sup>{" "}
                          + <Var>GAg</Var>
                          <sub>i</sub>
                          <sup>
                            <Var>E</Var>
                            <sub>i</sub>
                          </sup>
                        </>
                      }
                    />
                  </span>
                </div>
                <p className="mt-2.5 text-center text-xs text-muted-foreground">
                  <Var>P</Var> = 0.22 for Fall 5v5 (compressing{" "}
                  <ConceptLink href={CONCEPT_URLS.overdispersion}>overdispersed</ConceptLink> outdoor scoring) and{" "}
                  <Var>P</Var> = 0.458 for high-scoring Summer 4v4.
                </p>
              </FormulaCard>

              <FormulaCard
                label={
                  <>
                    3. <ConceptLink href={CONCEPT_URLS.empiricalBayes}>Empirical Bayes</ConceptLink> shrinkage toward
                    .500
                  </>
                }
              >
                <div className="flex items-center justify-center">
                  <span>
                    <Var>S</Var>
                    <sub>i</sub> = clamp<sub>[0.05, 0.95]</sub>
                    {" ("}
                    <Fraction
                      num={
                        <>
                          <Var>GP</Var>
                          <sub>i</sub> · <Var>S</Var>
                          <sub>raw, i</sub> + <Var>C</Var> · 0.5
                        </>
                      }
                      den={
                        <>
                          <Var>GP</Var>
                          <sub>i</sub> + <Var>C</Var>
                        </>
                      }
                    />
                    {")"}
                  </span>
                </div>
                <p className="mt-2.5 text-center text-xs text-muted-foreground">
                  <Var>C</Var> = 4 games (combined with <Var>m</Var> = 4, total effective prior ≈ 8 games).
                </p>
              </FormulaCard>

              <FormulaCard
                label={
                  <>
                    4. Per-simulation Bayesian <ConceptLink href={CONCEPT_URLS.betaDist}>Beta</ConceptLink> strength
                    uncertainty
                  </>
                }
              >
                <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
                  <span>
                    <Var>θ</Var>
                    <sub>i</sub> ~ Beta(<Var>κ</Var>
                    <sub>i</sub>
                    <Var>S</Var>
                    <sub>i</sub>, <Var>κ</Var>
                    <sub>i</sub>(1 − <Var>S</Var>
                    <sub>i</sub>))
                  </span>
                  <span>
                    <Var>κ</Var>
                    <sub>i</sub> = <Var>k</Var> · (<Var>GP</Var>
                    <sub>i</sub> + <Var>C</Var> + <Var>m</Var>)
                  </span>
                </div>
                <p className="mt-2.5 text-center text-xs text-muted-foreground">
                  Drawn once per simulated season via{" "}
                  <ConceptLink href={CONCEPT_URLS.marsagliaTsang}>Marsaglia–Tsang Gamma sampling</ConceptLink> (
                  <Var>k</Var> = {BASH_CALIBRATION.fall.strengthConcentration} Fall, <Var>k</Var> ={" "}
                  {BASH_CALIBRATION.summer.strengthConcentration} Summer), widening early-season uncertainty and
                  automatically narrowing as games played grows.
                </p>
              </FormulaCard>
            </div>

            {/* Model B: BASH Full-Strength Adj */}
            <div className="space-y-4 rounded-xl border border-border bg-card p-5 sm:p-6">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">
                  B. BASH Full-Strength Adj (Attendance-Adjusted)
                </h3>
                <p className="text-pretty text-sm text-muted-foreground">
                  Uses the exact same Gamma-Poisson + PythagenPuck + Empirical Bayes + Beta posterior pipeline as{" "}
                  <strong className="font-medium text-foreground">BASH Weighted</strong>, after symmetrically adjusting
                  each played game&apos;s goals for and against back to even bench attendance (preserving total goals):
                </p>
              </div>
              <FormulaCard label="Symmetric goal-rate de-attending (two-sided boxscores)">
                <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px]">
                  <span>
                    Δ<Var>g</Var> = <Var>β</Var>
                    <sub>gd</sub> · ln(<Var>att</Var>
                    <sub>team</sub> / <Var>att</Var>
                    <sub>opp</sub>)
                  </span>
                  <span>
                    <Var>GF</Var>&prime; = max(0, <Var>GF</Var> − 0.5Δ<Var>g</Var>)
                  </span>
                  <span>
                    <Var>GA</Var>&prime; = max(0, <Var>GA</Var> + 0.5Δ<Var>g</Var>)
                  </span>
                </div>
                <p className="mt-2.5 text-center text-xs text-muted-foreground">
                  Calibrated across 2,033 historical BASH boxscores (<Var>β</Var>
                  <sub>gd</sub> = {BASH_CALIBRATION.fall.attendance.goalDiffSlope} Fall,{" "}
                  {BASH_CALIBRATION.summer.attendance.goalDiffSlope} Summer). Games missing boxscore attendance on
                  either side remain unadjusted.
                </p>
              </FormulaCard>
            </div>

            {/* Model C: 50/50 */}
            <div className="space-y-2 rounded-xl border border-border bg-card p-5 sm:p-6">
              <h3 className="text-base font-semibold text-foreground">C. 50/50 (Coin Flip)</h3>
              <p className="text-pretty text-sm text-muted-foreground">
                Sets <Var>θ</Var>
                <sub>i</sub> = <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">0.500</code>{" "}
                fixed for every team across all iterations, while preserving BASH&apos;s exact 3-2-1 scoring, extra-time
                rates, and Rule 213 tiebreakers. Equivalent to Sports Club Stats&apos;s classic{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">2.html</code> view — it
                isolates pure standings and schedule math.
              </p>
            </div>

            {/* Model D: SCS Classic */}
            <div className="space-y-4 rounded-xl border border-border bg-card p-5 sm:p-6">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">D. SCS Classic (Sports Club Stats Replica)</h3>
                <p className="text-pretty text-sm text-muted-foreground">
                  Uses raw points percentage <Var>S</Var>
                  <sub>raw, i</sub> = <Var>PTS</Var>
                  <sub>i</sub> / (3 · <Var>GP</Var>
                  <sub>i</sub>) regressed toward{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">.500</code> using{" "}
                  <ConceptLink href={CONCEPT_URLS.scsP225}>
                    Ken Roberts&apos;s exact March 2, 2009 (p225) piecewise-linear curve
                  </ConceptLink>{" "}
                  over season completion <Var>f</Var> = <Var>GP</Var> / (<Var>GP</Var> + <Var>Rem</Var>):
                </p>
              </div>
              <FormulaCard label="Ken Roberts p225 piecewise regression (10% floor)">
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                    <span>
                      <Var>r</Var>(<Var>f</Var>) =
                    </span>
                    <span className="inline-flex flex-col border-l-2 border-foreground/40 pl-3 text-left text-[13px] leading-snug">
                      <span>
                        (−1.5<Var>f</Var> + 1.0) + 0.1<Var>f</Var>{" "}
                        <span className="text-muted-foreground">if f &lt; 0.5</span>
                      </span>
                      <span>
                        (−0.5<Var>f</Var> + 0.5) + 0.1<Var>f</Var>{" "}
                        <span className="text-muted-foreground">if f ≥ 0.5</span>
                      </span>
                    </span>
                  </div>
                  <div>
                    <Var>S</Var>
                    <sub>i</sub> = <Var>S</Var>
                    <sub>raw, i</sub> − (<Var>S</Var>
                    <sub>raw, i</sub> − 0.5) · <Var>r</Var>(<Var>f</Var>)
                  </div>
                </div>
                <p className="mt-2.5 text-center text-xs text-muted-foreground">
                  Starts at 100% regression (0 GP → .500), hits 30% regression at mid-season, and retains a 10% floor at
                  season&apos;s end. Uses fixed regressed strengths (no Beta posterior sampling) for faithful Sports Club
                  Stats parity.
                </p>
              </FormulaCard>
            </div>
          </section>

          {/* Section 5: Matchups & Outcomes */}
          <section id="outcomes" className="scroll-mt-20 space-y-5">
            <ArticleHeading number="05" title="From ratings to 6 game outcomes" />
            <p className="max-w-[68ch] text-pretty">
              For each remaining game between Away team <Var>a</Var> and Home team <Var>h</Var>, we convert their
              simulated season strengths (<Var>θ</Var>
              <sub>a</sub>, <Var>θ</Var>
              <sub>h</sub>) into six mutually exclusive outcomes (Home Reg, Home OT, Home SO, Away SO, Away OT, Away
              Reg):
            </p>

            <FormulaCard
              label={
                <>
                  1. <ConceptLink href={CONCEPT_URLS.log5}>Bill James Log5</ConceptLink> win probability (zero home-ice
                  advantage)
                </>
              }
            >
              <div className="flex items-center justify-center">
                <span>
                  <Var>p</Var>
                  <sub>h</sub> ={" "}
                  <Fraction
                    num={
                      <>
                        <Var>θ</Var>
                        <sub>h</sub>(1 − <Var>θ</Var>
                        <sub>a</sub>)
                      </>
                    }
                    den={
                      <>
                        <Var>θ</Var>
                        <sub>h</sub>(1 − <Var>θ</Var>
                        <sub>a</sub>) + <Var>θ</Var>
                        <sub>a</sub>(1 − <Var>θ</Var>
                        <sub>h</sub>)
                      </>
                    }
                  />
                </span>
              </div>
              <p className="mt-2.5 text-center text-xs text-muted-foreground">
                Because BASH plays all games at a single neutral outdoor venue (James Lick Middle School in Fall;
                Dolores Park in Summer), empirical home win% is 49.3% — so <Var>HFA</Var> = 0.50 (zero offset).
              </p>
            </FormulaCard>

            <FormulaCard label="2. Normalized extra-time scaling &amp; 3-2-1 points decompression">
              <div className="flex flex-col items-center gap-2 text-center">
                <div>
                  <Var>c</Var>
                  <sub>g</sub> = 0.5 + 0.5 · 4<Var>p</Var>
                  <sub>h</sub>(1 − <Var>p</Var>
                  <sub>h</sub>)
                </div>
                <div>
                  <Var>p</Var>
                  <sub>extra, g</sub> = min{" ("}0.60, (<Var>otRate</Var> + <Var>soRate</Var>) ·{" "}
                  <Fraction num={<><Var>c</Var><sub>g</sub></>} den={<span className="overline">c</span>} />
                  {")"}
                </div>
                <div>
                  <Var>k</Var> ={" "}
                  <Fraction
                    num={
                      <>
                        3<Var>p</Var>
                        <sub>reg, g</sub> + 0.7<Var>p</Var>
                        <sub>OT, g</sub> + 0.3<Var>p</Var>
                        <sub>SO, g</sub>
                      </>
                    }
                    den="3"
                  />
                  , &nbsp;&nbsp;
                  <Var>q</Var> = clamp<sub>[0.02, 0.98]</sub>
                  {" ("}0.5 +{" "}
                  <Fraction
                    num={
                      <>
                        <Var>p</Var>
                        <sub>h</sub> − 0.5
                      </>
                    }
                    den={<Var>k</Var>}
                  />
                  {")"}
                </div>
              </div>
              <p className="mt-2.5 text-center text-xs text-muted-foreground">
                Evenly matched teams reach OT/SO more often than mismatches, while normalizing by the season mean
                closeness <span className="overline">c</span> (computed via a 100-draw Beta expectation when strength
                sampling is active so Jensen&apos;s inequality does not pull realized rates down) preserves the
                league-wide target rate (12.0% Fall, 9.0% Summer). Decompressing into regulation propensity{" "}
                <Var>q</Var> removes ~9% double compression so expected 3-2-1 points share matches Log5.
              </p>
            </FormulaCard>

            <p className="max-w-[68ch] text-pretty">
              Inside overtime, sudden death preserves 70% of the edge (
              <Var>p</Var>
              <sub>h, OT</sub> = 0.5 + 0.7(<Var>q</Var> − 0.5)), whereas shootouts compress toward a coin flip (
              <Var>p</Var>
              <sub>h, SO</sub> = 0.5 + 0.3(<Var>q</Var> − 0.5)). For tiebreaker fidelity, OT/SO games add a +1 goal
              margin (with {BASH_CALIBRATION.fall.otLoserGoals} loser goals in Fall and{" "}
              {BASH_CALIBRATION.summer.otLoserGoals} in Summer) and regulation games draw from empirical BASH margin
              CDFs (1 through 6+ goals: Fall{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[12px] text-foreground">
                [21.7%, 19.8%, 18.3%, 14.3%, 9.0%, 17.0%]
              </code>{" "}
              with {BASH_CALIBRATION.fall.regLoserGoals} loser goals; Summer{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[12px] text-foreground">
                [21.5%, 17.6%, 15.4%, 12.5%, 10.7%, 22.3%]
              </code>{" "}
              with {BASH_CALIBRATION.summer.regLoserGoals} loser goals).
            </p>
          </section>

          {/* Section 6: Rules & Max-Flow */}
          <section id="rules" className="scroll-mt-20 space-y-4">
            <ArticleHeading number="06" title="BASH rules, tiebreakers &amp; max-flow guardrails" />
            <p className="max-w-[68ch] text-pretty">
              Every simulated season resolves final standings under official{" "}
              <Link href="/rulebook" className="font-medium text-primary underline underline-offset-2 hover:no-underline">
                BASH Rulebook
              </Link>{" "}
              rules:
            </p>
            <ul className="max-w-[68ch] list-disc space-y-2 pl-5 text-pretty">
              <li>
                <strong className="font-semibold text-foreground">3-2-1 Scoring (Rule 213) &amp; Forfeits (Rule 208):</strong>{" "}
                Regulation win = 3 pts (+1 ROW), OT win = 2 pts (+1 ROW), shootout win = 2 pts (0 ROW), OT/SO loss = 1
                pt, regulation loss = 0 pts. Historical non-forfeit ties award 1 pt each (0 ROW). Single forfeits award
                a 5–0 (3-pt) win; double forfeits record 0–5 (0-pt) losses for both clubs.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Rule 213 Tiebreaker Ladder:</strong>{" "}
                (1) Points → (2) ROW (regulation + OT wins, excluding shootout wins) → (3) Head-to-head % of available
                points among tied clubs (evaluated recursively on narrowed subgroups, falling through if the H2H graph
                is disconnected) → (4) Goal differential → (5) Goals for (standings-table fallback beyond official Rule
                213(iv)) → (6) Draw lots (per-iteration random tiebreak, eliminating alphabetical bias).
              </li>
              <li>
                <strong className="font-semibold text-foreground">Playoff Formats (Rules 412 &amp; 219):</strong>{" "}
                7-team Fall seasons qualify the top 5 (Seeds 1–3 earn semifinal byes; Seeds 4 &amp; 5 play a single
                Play-In game). 6-team Fall seasons qualify the top 4. All Summer teams qualify, so the UI shifts focus
                to seed probabilities and top-seed races.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Exact Max-Flow Clinch &amp; Elimination Guardrail:</strong>{" "}
                Following{" "}
                <ConceptLink href={CONCEPT_URLS.scsP270}>Ken Roberts&apos;s famous 2009 Senators lesson</ConceptLink>{" "}
                (where a 3-in-50,000,000 tiebreaker path kept a team alive), Monte Carlo 100.0% or 0.0% never triggers an{" "}
                <strong className="font-semibold text-foreground">In</strong> or{" "}
                <strong className="font-semibold text-foreground">Out</strong> badge on its own. Instead, we solve an{" "}
                <ConceptLink href={CONCEPT_URLS.edmondsKarp}>Edmonds–Karp max-flow</ConceptLink> network over the
                remaining schedule&apos;s points and ROW bounds (treating H2H/GD conservatively so neither label is ever
                awarded falsely). Unverified extremes display honestly as{" "}
                <span className="tabular-nums font-medium text-foreground">&gt;99.9%</span> or{" "}
                <span className="tabular-nums font-medium text-foreground">&lt;0.1%</span>.
              </li>
            </ul>
          </section>

          {/* Section 7: Calibration & LOSO Validation */}
          <section id="calibration" className="scroll-mt-20 space-y-6">
            <ArticleHeading number="07" title="Empirical calibration &amp; LOSO validation" />
            <p className="max-w-[68ch] text-pretty">
              Why not simply plug in NHL constants? Across BASH&apos;s historical database (2,126 non-forfeit
              regular-season games, including 2,107 decisive games across 27 Fall and 27 Summer seasons), outdoor
              street hockey behaves very differently from pro ice hockey: scoring is ~1.6×{" "}
              <ConceptLink href={CONCEPT_URLS.overdispersion}>overdispersed</ConceptLink> (
              <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">var/mean ≈ 1.60–1.63</code>{" "}
              vs. ~1.1 in the NHL), rosters fluctuate week to week, and overtime happens half as often. Applying
              uncalibrated NHL <ConceptLink href={CONCEPT_URLS.pythagenPuck}>PythagenPuck</ConceptLink> (<Var>P</Var> =
              0.458) to BASH Fall actually scores worse than flipping a coin.
            </p>

            {/* Table 1: Calibration Constants */}
            <div className="space-y-2">
              <div
                tabIndex={0}
                role="region"
                aria-labelledby="table-calibration-caption"
                className="overflow-x-auto rounded-xl border border-border bg-card focus-visible:outline-2 focus-visible:outline-primary"
              >
                <table className="w-full border-collapse text-left text-xs sm:text-[13px]">
                  <caption
                    id="table-calibration-caption"
                    className="border-b border-border bg-muted/40 px-4 py-2.5 text-left text-xs font-semibold text-foreground"
                  >
                    Table 1 — Calibrated BASH simulation parameters vs. NHL reference
                  </caption>
                  <thead>
                    <tr className="border-b border-border bg-muted/20 text-muted-foreground">
                      <th scope="col" className="text-balance px-4 py-2.5 font-semibold">
                        Parameter
                      </th>
                      <th scope="col" className="text-balance px-4 py-2.5 font-semibold">
                        BASH Fall (5v5)
                      </th>
                      <th scope="col" className="text-balance px-4 py-2.5 font-semibold">
                        BASH Summer (4v4)
                      </th>
                      <th scope="col" className="text-balance px-4 py-2.5 font-semibold">
                        NHL Reference
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {CALIBRATION_COMPARISON.map((row) => (
                      <tr key={row.param} className="hover:bg-muted/20">
                        <th scope="row" className="px-4 py-2.5 font-medium text-foreground">
                          {row.param}
                        </th>
                        <td className="px-4 py-2.5 tabular-nums">{row.fall}</td>
                        <td className="px-4 py-2.5 tabular-nums">{row.summer}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground/80">{row.nhl}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="max-w-[68ch] text-pretty">
              To avoid in-sample overfitting, we tuned (<Var>P</Var>, <Var>C</Var>, <Var>m</Var>) using nested
              season-blocked{" "}
              <ConceptLink href={CONCEPT_URLS.crossValidation}>
                Leave-One-Season-Out (LOSO) cross-validation
              </ConceptLink>
              : holding out each entire season, fitting parameters strictly on the remaining 26 seasons, and scoring
              every held-out game causally (using only prior games in that season) on 4-outcome{" "}
              <ConceptLink href={CONCEPT_URLS.rps}>Ranked Probability Score (RPS)</ConceptLink>, 3-2-1 expected-points
              RMSE, and binary <ConceptLink href={CONCEPT_URLS.brier}>Brier score</ConceptLink>.
            </p>

            {/* Table 2: LOSO Results */}
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="table-loso-caption"
              className="overflow-x-auto rounded-xl border border-border bg-card focus-visible:outline-2 focus-visible:outline-primary"
            >
              <table className="w-full border-collapse text-left text-xs sm:text-[13px]">
                <caption
                  id="table-loso-caption"
                  className="border-b border-border bg-muted/40 px-4 py-2.5 text-left text-xs font-semibold text-foreground"
                >
                  Table 2 — Nested LOSO out-of-sample accuracy across 54 BASH seasons (lower is better)
                </caption>
                <thead>
                  <tr className="border-b border-border bg-muted/20 text-muted-foreground">
                    <th scope="col" className="text-balance px-4 py-2.5 font-semibold">
                      Model
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      Fall RPS
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      Fall Pts RMSE
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      Fall Brier
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      Summer RPS
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      Summer Pts RMSE
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                      Summer Brier
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {LOSO_RESULTS.map((row) => (
                    <tr
                      key={row.model}
                      className={row.highlight ? "bg-muted/40 font-medium text-foreground" : "hover:bg-muted/20"}
                    >
                      <th scope="row" className="px-4 py-2.5 font-medium text-foreground">
                        {row.model}
                      </th>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.fallRps}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.fallRmse}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.fallBrier}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.summerRps}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.summerRmse}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.summerBrier}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="max-w-[68ch] text-pretty text-sm">
              In paired <ConceptLink href={CONCEPT_URLS.blockBootstrap}>season-block bootstrap</ConceptLink> testing
              (2,000 resamples across seasons),{" "}
              <strong className="font-semibold text-foreground">BASH Weighted</strong> outperforms{" "}
              <strong className="font-semibold text-foreground">50/50</strong> (100% Fall, 99.0% Summer) and{" "}
              <strong className="font-semibold text-foreground">SCS Classic</strong> (97.9% Fall, 100% Summer) at 95%
              confidence, and outperforms shrunk points percentage significantly in Summer (97.7%) while edging it out
              in Fall (84.7%).
            </p>

            {/* Table 3: Bayesian Coverage */}
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="table-coverage-caption"
              className="overflow-x-auto rounded-xl border border-border bg-card focus-visible:outline-2 focus-visible:outline-primary"
            >
              <table className="w-full border-collapse text-left text-xs sm:text-[13px]">
                <caption
                  id="table-coverage-caption"
                  className="border-b border-border bg-muted/40 px-4 py-2.5 text-left text-xs font-semibold text-foreground"
                >
                  Table 3 — Bayesian Beta concentration calibration (empirical 80% / 90% interval coverage on remaining-season points %)
                </caption>
                <thead>
                  <tr className="border-b border-border bg-muted/20 text-muted-foreground">
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Concentration (k)
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      Fall 80%
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      Fall 90%
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      Summer 80%
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      Summer 90%
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Takeaway
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {COVERAGE_RESULTS.map((row) => (
                    <tr key={row.k} className="hover:bg-muted/20">
                      <th scope="row" className="px-4 py-2.5 font-medium text-foreground">
                        {row.k}
                      </th>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.fall80}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.fall90}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.summer80}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.summer90}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm space-y-3">
              <div>
                <h3 className="mb-1.5 font-semibold text-foreground">
                  Attendance impact &amp; BASH Full-Strength Adj
                </h3>
                <p className="text-pretty text-muted-foreground">
                  Across <span className="font-medium text-foreground tabular-nums">1,535</span> Fall and{" "}
                  <span className="font-medium text-foreground tabular-nums">498</span> Summer regular-season games
                  with boxscores, dressed headcount (distinct{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[12px]">player_id</code> union across skaters
                  and goalies) follows a diminishing-returns{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[12px]">ln(att)</code> curve: in LOSO
                  cross-validation, adding <code className="rounded bg-muted px-1 py-0.5 text-[12px]">ln(homeAtt / awayAtt)</code>{" "}
                  improved out-of-sample game accuracy from 57.2% to 62.2% in Fall and 55.0% to 59.4% in Summer.
                  To compute <strong className="font-medium text-foreground">Full Str</strong> without any scale
                  mismatch, each played game with two-sided boxscores is symmetrically de-attended by{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[12px]">
                    attGd = goalDiffSlope × ln(teamAtt / oppAtt)
                  </code>{" "}
                  (clamped at 0, preserving total game goals) before entering the exact same PythagenPuck + Empirical
                  Bayes pipeline. Default <strong className="font-medium text-foreground">BASH Weighted</strong>{" "}
                  remains anchored to Observed Str; selecting{" "}
                  <strong className="font-medium text-foreground">BASH Full-Strength Adj</strong> simulates the season
                  and timeline using Full Str, and Big Games{" "}
                  <strong className="font-medium text-foreground">What-If Attendance</strong> shifts matchup log-odds by{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[12px]">
                    logOddsSlope × ln(homePreset / awayPreset)
                  </code>
                  .
                </p>
              </div>
              <div>
                <h3 className="mb-1.5 font-semibold text-foreground">Known limitations (disclosed upfront)</h3>
                <ul className="list-disc space-y-1 pl-5 text-pretty text-muted-foreground">
                  <li>
                    <strong className="font-medium text-foreground">Early-season Strength of Schedule:</strong> Prior to
                    completing a full round-robin cycle, goal differentials are not opponent-adjusted; schedule balance
                    self-corrects once every club plays every opponent.
                  </li>
                  <li>
                    <strong className="font-medium text-foreground">Stationary team strength &amp; observational attendance:</strong>{" "}
                    Default BASH Weighted simulations assume current observed team quality remains constant through the
                    remaining schedule and do not predict future RSVPs, mid-season trades, or individual player/goalie
                    availability. Fitted attendance slopes in BASH Full-Strength Adj and What-If Attendance are observational
                    and can partially reflect confounders such as late-season morale/elimination, absent top scorers or
                    starting goalies, and substitute players (<code className="rounded bg-muted px-1 py-0.5 text-[12px]">is_sub</code>).
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 8: Big Games, What-If & Noise Hygiene */}
          <section id="big-games" className="scroll-mt-20 space-y-4">
            <ArticleHeading number="08" title="Big Games, What-If &amp; noise hygiene" />
            <ul className="max-w-[68ch] list-disc space-y-2.5 pl-5 text-pretty">
              <li>
                <strong className="font-semibold text-foreground">Single-pass conditional tallying:</strong> Rather
                than re-running separate simulations per upcoming game (which Ken Roberts discovered in 2009 could
                produce contradictory &ldquo;strength drift&rdquo; bugs), every iteration buckets each team&apos;s final
                outcome by what happened in each upcoming game inside one unified 100,000-run pass.
              </li>
              <li>
                <strong className="font-semibold text-foreground">
                  Regulation-anchored swings &amp;{" "}
                  <ConceptLink href={CONCEPT_URLS.zTest}>z-test</ConceptLink> filter:
                </strong>{" "}
                Game leverage is measured between Away Reg and Home Reg outcomes (avoiding upward bias from smaller
                OT/SO sample buckets). Third-party scoreboard-watching teams appear only when their swing exceeds{" "}
                <span className="tabular-nums font-medium text-foreground">≥ 0.5 pp</span> playoff odds (or{" "}
                <span className="tabular-nums font-medium text-foreground">≥ 0.15</span> avg seed) and passes{" "}
                <span className="tabular-nums font-medium text-foreground">z ≥ 2.5</span>. Outcomes with fewer than{" "}
                <span className="tabular-nums font-medium text-foreground">500</span> simulated seasons are flagged{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">*</code>.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Isolated What-If tail probing:</strong> In each
                team&apos;s &ldquo;How they need to finish&rdquo; table, rows with fewer than 250 simulated seasons are
                flagged <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">*</code>, and
                extreme win-out / lose-out rows are populated via an isolated 1,000-run probe that never mixes into
                main playoff probabilities.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Honest precision &amp; noise floors:</strong> At
                100,000 simulations, the 95% Monte Carlo margin of error near 50% is{" "}
                <span className="tabular-nums font-medium text-foreground">±0.3 pp</span>. Seed hover tooltips show 1
                decimal place alongside the 95% margin (e.g.,{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">36.1% ±0.3</code>), and
                matchday change badges suppress sub-noise jitter (&lt; 0.5 pp server, &lt; 1.0 pp in 20k client
                What-If).
              </li>
            </ul>
          </section>

          {/* Section 9: References */}
          <section id="references" className="scroll-mt-20 space-y-6">
            <ArticleHeading number="09" title="References, archives &amp; further reading" />
            <p className="max-w-[68ch] text-pretty">
              All primary sources, Internet Archive captures, and published papers referenced during the design and
              verification of BASH&apos;s simulator:
            </p>
            <div className="space-y-6">
              {REFERENCES.map((group) => (
                <div key={group.category} className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">{group.category}</h3>
                  <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                    {group.items.map((ref) => (
                      <li key={ref.href} className="p-4">
                        <a
                          href={ref.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group inline-flex items-baseline gap-1.5 text-sm font-semibold text-foreground transition-colors hover:text-primary"
                        >
                          <span className="break-words">{ref.title}</span>
                          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                        </a>
                        <p className="mt-1 text-pretty text-xs leading-relaxed text-muted-foreground">{ref.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Footer CTA */}
          <footer className="rounded-xl border border-border bg-card p-6 sm:flex sm:items-center sm:justify-between sm:gap-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">Explore the live simulations</h2>
              <p className="text-sm text-muted-foreground">
                Compare BASH Weighted, BASH Full-Strength Adj, 50/50, and SCS Classic or test your own What-If scenarios.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 sm:mt-0 sm:shrink-0">
              <Link
                href="/standings?view=odds"
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-90"
              >
                Open Playoff Odds
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/rulebook"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted/60"
              >
                BASH Rulebook
              </Link>
            </div>
          </footer>
        </article>
      </main>
    </div>
  )
}

function ArticleHeading({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-border/70 pb-2">
      <span className="font-mono text-xs font-medium tabular-nums text-muted-foreground">{number}</span>
      <h2 className="text-balance text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h2>
    </div>
  )
}

function FormulaCard({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/80 bg-muted/35 px-4 py-3.5">
      <div className="mb-2 text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="font-mono text-sm text-foreground">{children}</div>
    </div>
  )
}

function ConceptLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary hover:decoration-primary"
    >
      {children}
    </a>
  )
}

function Fraction({ num, den }: { num: React.ReactNode; den: React.ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex flex-col items-center align-middle text-[13px] leading-tight">
      <span className="border-b border-foreground/50 px-1.5 pb-0.5">{num}</span>
      <span className="px-1.5 pt-0.5">{den}</span>
    </span>
  )
}

function Var({ children }: { children: React.ReactNode }) {
  return <span className="italic">{children}</span>
}
