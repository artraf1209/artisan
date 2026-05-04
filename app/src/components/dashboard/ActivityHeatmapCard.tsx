type ActivityDay = {
  date: string
  count: number
}

export type ActivityLane = {
  label: string
  noun: string
  days: ActivityDay[]
  total: number
}

function chunkDays(days: ActivityDay[]): ActivityDay[][] {
  return Array.from({ length: 3 }, (_, rowIndex) =>
    days.slice(rowIndex * 10, rowIndex * 10 + 10),
  )
}

function intensityClass(count: number, maxCount: number) {
  if (count <= 0 || maxCount <= 0) return 'bg-muted/35'
  const ratio = count / maxCount
  if (ratio >= 0.75) return 'bg-foreground'
  if (ratio >= 0.5) return 'bg-foreground/75'
  if (ratio >= 0.25) return 'bg-muted-foreground/65'
  return 'bg-muted-foreground/40'
}

function formatDayLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export default function ActivityHeatmapCard({
  lanes,
}: {
  lanes: ActivityLane[]
}) {
  const totalEvents = lanes.reduce((sum, lane) => sum + lane.total, 0)
  const busiestLane = [...lanes].sort((left, right) => right.total - left.total)[0]

  return (
    <div className="surface-panel col-span-1 p-6 md:col-span-2 xl:col-span-5">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Activity</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-foreground">
            Queue + signal pulse
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">last 30 days</p>
          <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-foreground">
            {totalEvents}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {lanes.map((lane) => {
          const maxCount = lane.days.reduce((max, day) => Math.max(max, day.count), 0)
          const rows = chunkDays(lane.days)

          return (
            <div key={lane.label} className="space-y-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{lane.label}</p>
                  <p className="text-xs text-muted-foreground">{lane.total} tracked events</p>
                </div>
                <p className="text-lg font-semibold tracking-[-0.04em] text-foreground">
                  {lane.total}
                </p>
              </div>

              <div className="space-y-3">
                {rows.map((row, rowIndex) => (
                  <div key={`${lane.label}-${rowIndex}`} className="flex gap-2">
                    {row.map((day) => (
                      <span
                        key={`${lane.label}-${day.date}`}
                        title={`${formatDayLabel(day.date)}: ${day.count} ${lane.noun}`}
                        className={`h-2.5 w-2.5 rounded-full transition-colors ${intensityClass(day.count, maxCount)}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="surface-soft mt-8 flex items-center gap-4 p-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-2xl font-semibold text-foreground">
          {Math.max(1, Math.min(9, busiestLane?.total ?? 1))}
        </div>
        <div>
          <p className="text-2xl font-semibold tracking-[-0.05em] text-foreground">
            Real review cadence
          </p>
          <p className="text-sm text-muted-foreground">
            {lanes[0]?.total ?? 0} flow events, {lanes[1]?.total ?? 0} queue decisions, and{' '}
            {lanes[2]?.total ?? 0} new signals tracked over the last 30 days.
          </p>
        </div>
      </div>
    </div>
  )
}
