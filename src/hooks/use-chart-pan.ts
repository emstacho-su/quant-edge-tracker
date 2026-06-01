import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type ChartWindow = 7 | 30 | 90 | null

const DAY_MS = 24 * 60 * 60 * 1000

export interface PanBounds {
  /** Earliest data point in ms. */
  earliest: number
  /** Latest data point in ms. */
  latest: number
  /** Window width in days; null = "All". */
  windowDays: ChartWindow
}

export interface VisibleRange {
  start: number
  end: number
}

/**
 * Clamps an `endDateMs` candidate to the legal pan range for `windowDays`.
 * Exported for unit testing.
 */
export function clampEndDate(
  candidate: number,
  bounds: PanBounds,
): number {
  if (bounds.windowDays === null) return bounds.latest
  const windowMs = bounds.windowDays * DAY_MS
  const leftBound = bounds.earliest + windowMs
  const rightBound = bounds.latest
  if (leftBound > rightBound) return rightBound // window wider than data
  return Math.min(Math.max(candidate, leftBound), rightBound)
}

export function visibleRangeFor(
  endDateMs: number,
  bounds: PanBounds,
): VisibleRange {
  if (bounds.windowDays === null) {
    return { start: bounds.earliest, end: bounds.latest }
  }
  return {
    start: endDateMs - bounds.windowDays * DAY_MS,
    end: endDateMs,
  }
}

export interface UseChartPanInput {
  /** All available data point dates (ms since epoch), ascending. */
  allDates: number[]
  windowDays: ChartWindow
}

export interface UseChartPanResult {
  visibleRange: VisibleRange
  disabled: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  dragHandlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
  }
  atLeftBound: boolean
  atRightBound: boolean
}

export function useChartPan({
  allDates,
  windowDays,
}: UseChartPanInput): UseChartPanResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{
    pointerId: number
    startX: number
    startEnd: number
  } | null>(null)
  const pendingFrameRef = useRef<number | null>(null)
  const pendingDeltaRef = useRef<number>(0)

  const earliest = allDates.length > 0 ? allDates[0] : Date.now()
  const latest = allDates.length > 0 ? allDates[allDates.length - 1] : Date.now()

  const bounds: PanBounds = useMemo(
    () => ({ earliest, latest, windowDays }),
    [earliest, latest, windowDays],
  )

  const disabled =
    windowDays === null ||
    allDates.length < 2 ||
    earliest + windowDays * DAY_MS > latest

  const [endDateMs, setEndDateMs] = useState<number>(latest)

  useEffect(() => {
    setEndDateMs((cur) => clampEndDate(cur === 0 ? latest : cur, bounds))
  }, [bounds, latest])

  const visibleRange = useMemo(
    () => visibleRangeFor(endDateMs, bounds),
    [endDateMs, bounds],
  )

  const atLeftBound =
    !disabled &&
    windowDays !== null &&
    endDateMs <= earliest + windowDays * DAY_MS + 1
  const atRightBound = !disabled && endDateMs >= latest - 1

  const applyPending = useCallback(() => {
    pendingFrameRef.current = null
    const ds = dragStateRef.current
    if (!ds || windowDays === null) return
    const width = containerRef.current?.offsetWidth ?? 1
    const daysPerPx = windowDays / Math.max(width, 1)
    const newEnd = ds.startEnd - pendingDeltaRef.current * daysPerPx * DAY_MS
    setEndDateMs(clampEndDate(newEnd, bounds))
  }, [windowDays, bounds])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return
      dragStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startEnd: endDateMs,
      }
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* no-op */
      }
    },
    [disabled, endDateMs],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (
        !dragStateRef.current ||
        e.pointerId !== dragStateRef.current.pointerId
      )
        return
      pendingDeltaRef.current = e.clientX - dragStateRef.current.startX
      if (pendingFrameRef.current == null) {
        pendingFrameRef.current = requestAnimationFrame(applyPending)
      }
    },
    [applyPending],
  )

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (
        !dragStateRef.current ||
        e.pointerId !== dragStateRef.current.pointerId
      )
        return
      if (pendingFrameRef.current != null) {
        cancelAnimationFrame(pendingFrameRef.current)
        pendingFrameRef.current = null
        applyPending()
      }
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        /* no-op */
      }
      dragStateRef.current = null
    },
    [applyPending],
  )

  return {
    visibleRange,
    disabled,
    containerRef,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    atLeftBound,
    atRightBound,
  }
}
