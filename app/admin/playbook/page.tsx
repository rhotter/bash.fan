import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Cerberus Playbook | Admin",
  description: "Commissioner help center and operations manual.",
}

export default function PlaybookPage() {
  return (
    <div className="space-y-8 max-w-4xl pb-12">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Cerberus Playbook</h1>
        <p className="text-muted-foreground">
          Welcome to the BASH Commissioner help center. Find guides, workflows, and operational best practices here.
        </p>
      </div>

      <div className="space-y-12">
        {/* Scheduling Guide Section */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold border-b pb-2">Scheduling Guide</h2>
          
          <div className="grid gap-6">
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">1. Regular Season Scheduling</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Use the <strong>Generate Round-Robin</strong> wizard on a season's Schedule tab to build your initial schedule. 
                The wizard will automatically pair every team to play each other the number of times you specify.
              </p>
              <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
                <li><strong>Holidays:</strong> The wizard highlights standard US holidays. Use the "Skip Week" feature to easily push games past a holiday weekend.</li>
                <li><strong>Mistakes happen:</strong> If you realize you messed up the dates or missed a holiday after saving, simply use the <strong>Delete Schedule</strong> button at the bottom of the schedule page to clear all <em>upcoming</em> games and run the wizard again.</li>
                <li><strong>Placeholder Mode:</strong> You can generate a schedule before teams are finalized by checking "Use Placeholders". Once your teams are drafted, use the <strong>Resolve Seeds</strong> button to bulk-swap your placeholders (e.g. "Team 1") into actual teams (e.g. "Thunder").</li>
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-semibold">2. Playoff Bracket</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                When the regular season is wrapping up, use the <strong>Generate Playoffs</strong> wizard.
              </p>
              <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
                <li><strong>Placeholders vs Known Teams:</strong> If you are scheduling playoffs before the final standings are locked in, leave the default "Placeholders" option checked. This will create generic matchups (e.g., "1st Seed vs 4th Seed") utilizing a temporary `tbd` sentinel team to safely preserve matchups. You can bulk-resolve these into real teams later using the <strong>Resolve Seeds</strong> button.</li>
                <li><strong>Default Dates:</strong> The wizard automatically looks at the final regular season game and defaults your playoff games to start the very next day.</li>
                <li><strong>Topological Insertion Order:</strong> Rest assured that when you build complex brackets, the system securely anchors final championship games before earlier rounds so your playoff tree's downstream references (e.g., &quot;Winner SF-A&quot;) remain structurally intact.</li>
              </ul>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold">3. Managing Playoff Series</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Playoff series can be unpredictable. Here is how to handle common scenarios:
              </p>
              
              <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
                <strong className="block text-sm text-foreground">Scenario A: A Best-of-3 Series Ends in a Sweep (2-0)</strong>
                <p className="text-sm text-muted-foreground">
                  If a team wins the first two games, Game 3 is no longer needed. You have two options:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  <li><strong>Delete it:</strong> Click the trash icon next to Game 3 to completely remove it from the schedule and free up the calendar slot.</li>
                  <li><strong>Cancel it:</strong> Click Edit on Game 3 and change its status to "Canceled". This leaves a record on the schedule that the game was officially called off.</li>
                </ul>
              </div>

              <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
                <strong className="block text-sm text-foreground">Scenario B: Shifting a Series Forward</strong>
                <p className="text-sm text-muted-foreground">
                  If both semi-finals end early in a sweep, you may want to move the Finals up to the newly freed weekend. 
                  Because every game is an independent record, you can easily shift the series:
                </p>
                <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
                  <li>Delete or Cancel the unneeded semi-final Game 3s.</li>
                  <li>Click <strong>Edit</strong> on Finals Game 1, and simply change the Date and Time to the newly opened slot.</li>
                  <li>Repeat for the rest of the Finals games to shift the whole series forward by a week.</li>
                  <li><em>Tip:</em> You can use this same Edit modal to select the actual advancing teams if they were previously set to placeholders.</li>
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* Space for future guides */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold border-b pb-2">Player Management</h2>
          <p className="text-sm text-muted-foreground">
            Coming soon: Guides on merging duplicate players, managing waivers, and roster drops.
          </p>
        </section>
      </div>
    </div>
  )
}
