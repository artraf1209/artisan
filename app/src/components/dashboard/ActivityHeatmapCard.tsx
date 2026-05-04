type ActivityPoint = {
  active: boolean
}

function buildActivityRows(count: number) {
  const points = Array.from({ length: 21 }, (_, index) => ({
    active: index < count,
  }))

  return [0, 1, 2].map((rowIndex) => points.filter((_, index) => index % 3 === rowIndex))
}

export default function ActivityHeatmapCard({
  tradeCount,
  signalCount,
}: {
  tradeCount: number
  signalCount: number
}) {
  const rows = buildActivityRows(Math.min(21, tradeCount + signalCount))

  return (
    <div className="surface-panel col-span-1 md:col-span-2 xl:col-span-7 p-6">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Activity</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-foreground">
            Trading pulse
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">last 30 days</p>
          <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-foreground">
            {tradeCount + signalCount}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {['Flow', 'Queue', 'Signals'].map((label, columnIndex) => (
          <div key={label} className="space-y-4">
            <p className="text-sm font-medium text-foreground">{label}</p>
            <div className="space-y-3">
              {rows.map((row, rowIndex) => (
                <div key={`${label}-${rowIndex}`} className="flex gap-2">
                  {row.map((point, index) => {
                    const highlighted =
                      point.active &&
                      (index + rowIndex + columnIndex) % Math.max(2, columnIndex + 2) === 0

                    return (
                      <span
                        key={`${label}-${rowIndex}-${index}`}
                        className={`h-2.5 w-2.5 rounded-full ${
                          highlighted ? 'bg-foreground' : point.active ? 'bg-muted-foreground/50' : 'bg-muted/40'
                        }`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="surface-soft mt-8 flex items-center gap-4 p-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-2xl font-semibold text-foreground">
          {Math.max(1, Math.min(9, tradeCount || signalCount || 1))}
        </div>
        <div>
          <p className="text-2xl font-semibold tracking-[-0.05em] text-foreground">
            Market + model cadence
          </p>
          <p className="text-sm text-muted-foreground">
            {tradeCount} trades and {signalCount} signals feeding the current dashboard rhythm.
          </p>
        </div>
      </div>
    </div>
  )
}
