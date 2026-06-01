export type ChartWindow = 7 | 30 | 90 | null

interface Props {
  value: ChartWindow
  onChange: (v: ChartWindow) => void
  options?: readonly ChartWindow[]
  className?: string
}

const DEFAULT_OPTIONS: readonly ChartWindow[] = [7, 30, 90, null]

function labelOf(opt: ChartWindow): string {
  return opt === null ? 'All' : `${opt}D`
}

export function ChartTimeRangePicker({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
  className = '',
}: Props) {
  return (
    <div
      className={`flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 ${className}`}
    >
      {options.map((opt) => {
        const selected = value === opt
        return (
          <button
            key={String(opt)}
            onClick={() => onChange(opt)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
              selected
                ? 'bg-purple-500/15 text-purple-400'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {labelOf(opt)}
          </button>
        )
      })}
    </div>
  )
}
