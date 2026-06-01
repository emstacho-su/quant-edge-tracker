import { useMemo } from 'react'
import { useBankroll } from './use-bankroll'
import {
  computeWeeklyUnit,
  getCashBankrollAtWeekStart,
  startOfWeek,
} from '@/utils/unit-size'

export interface AutoUnitSize {
  unitSize: number
  weekStart: Date
  bankrollAtWeekStart: number
  loading: boolean
}

export function useAutoUnitSize(): AutoUnitSize {
  const { events, loading } = useBankroll()
  return useMemo(() => {
    const now = new Date()
    const weekStart = startOfWeek(now)
    const bankrollAtWeekStart = getCashBankrollAtWeekStart(events, now)
    const unitSize = computeWeeklyUnit(bankrollAtWeekStart)
    return { unitSize, weekStart, bankrollAtWeekStart, loading }
  }, [events, loading])
}
