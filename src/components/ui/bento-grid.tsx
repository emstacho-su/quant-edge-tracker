import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface BentoItem {
  /** Short label / heading. */
  title: string
  /** Optional secondary inline note shown next to the title. */
  meta?: string
  /** Optional big-display value (KPI tiles). Rendered prominently below the header row. */
  value?: ReactNode
  /** Optional longer description below the value. */
  description?: string
  /** Optional leading icon — pass a lucide-react node sized to ~size-4. */
  icon?: ReactNode
  /** Optional badge text in the top-right (e.g. status, delta). */
  status?: string
  /** Optional pill tags rendered along the bottom. */
  tags?: string[]
  /** Optional CTA text revealed on hover (bottom-right). */
  cta?: string
  /** Tailwind grid colSpan on md+ (1 or 2). */
  colSpan?: 1 | 2
  /** Always-on hover state — used for spotlighting the headline tile. */
  hasPersistentHover?: boolean
  /** rgba color string consumed by the NeuralBackground proximity halo. */
  glow?: string
}

interface BentoGridProps {
  items: BentoItem[]
  /** Number of columns on md+ screens. Default 4. */
  columns?: 2 | 3 | 4
  className?: string
}

const COLUMNS_CLASS: Record<NonNullable<BentoGridProps['columns']>, string> = {
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-2 lg:grid-cols-4',
}

export function BentoGrid({ items, columns = 4, className }: BentoGridProps) {
  return (
    <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', COLUMNS_CLASS[columns], className)}>
      {items.map((item, index) => (
        <BentoCell key={`${item.title}-${index}`} item={item} />
      ))}
    </div>
  )
}

function BentoCell({ item }: { item: BentoItem }) {
  const spans = item.colSpan === 2 ? 'sm:col-span-2 md:col-span-2' : ''

  return (
    <div
      data-glow={item.glow ?? 'rgba(125,211,252,1)'}
      className={cn(
        'group relative overflow-hidden rounded-xl px-4 py-3 transition-transform duration-300',
        'glass-card',
        'hover:-translate-y-0.5 will-change-transform',
        item.hasPersistentHover && '-translate-y-0.5',
        spans,
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 transition-opacity duration-300',
          item.hasPersistentHover ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[length:4px_4px]" />
      </div>

      <div className="relative flex flex-col gap-2">
        <div className="flex items-center justify-between">
          {item.icon ? (
            <div className="flex size-7 items-center justify-center rounded-lg bg-foreground/5 text-foreground transition-colors duration-300 group-hover:bg-foreground/10">
              {item.icon}
            </div>
          ) : (
            <span aria-hidden className="size-7" />
          )}

          {item.status && (
            <span
              className={cn(
                'rounded-md bg-foreground/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground',
                'transition-colors duration-300 group-hover:bg-foreground/10 group-hover:text-foreground',
              )}
            >
              {item.status}
            </span>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {item.title}
            {item.meta && (
              <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">
                {item.meta}
              </span>
            )}
          </p>

          {item.value !== undefined && (
            <div className="text-xl font-bold tabular-nums text-foreground">{item.value}</div>
          )}

          {item.description && (
            <p className="text-sm leading-snug text-muted-foreground">{item.description}</p>
          )}
        </div>

        {(item.tags?.length || item.cta) && (
          <div className="mt-1 flex items-center justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {item.tags?.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-foreground/5 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors duration-200 hover:bg-foreground/10 hover:text-foreground"
                >
                  #{tag}
                </span>
              ))}
            </div>
            {item.cta && (
              <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                {item.cta}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
