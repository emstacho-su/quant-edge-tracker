import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'qe.demoMode'
const DIVISOR = 10

let _enabled = readInitial()
const _listeners = new Set<() => void>()

function readInitial(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(STORAGE_KEY) === 'true'
}

function notify() {
  _listeners.forEach((fn) => fn())
}

export const demoMode = {
  get enabled(): boolean {
    return _enabled
  },
  get divisor(): number {
    return _enabled ? DIVISOR : 1
  },
  setEnabled(on: boolean): void {
    if (on === _enabled) return
    _enabled = on
    try {
      localStorage.setItem(STORAGE_KEY, String(on))
    } catch {
      // ignore — quota / private mode
    }
    notify()
  },
  toggle(): void {
    this.setEnabled(!_enabled)
  },
  subscribe(fn: () => void): () => void {
    _listeners.add(fn)
    return () => {
      _listeners.delete(fn)
    }
  },
  scale(n: number): number {
    return n / this.divisor
  },
}

const _usdInner = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

/**
 * Drop-in replacement for `new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`.
 * When demo mode is on, values are divided by the demo divisor BEFORE formatting.
 * This is display-only — underlying data is never mutated.
 *
 * Components that render USD-formatted values should also call `useDemoMode()`
 * (or a parent must) so React re-renders when the demo toggle flips.
 */
export const USD = {
  format(n: number): string {
    return _usdInner.format(demoMode.scale(n))
  },
}

/**
 * Subscribe to demo-mode changes. Use this hook anywhere in the render tree
 * that should re-render when the demo toggle flips. Calling it once high in
 * the tree (e.g. Layout) is enough to propagate to descendants.
 */
export function useDemoMode(): {
  enabled: boolean
  divisor: number
  setEnabled: (on: boolean) => void
  toggle: () => void
} {
  const enabled = useSyncExternalStore(
    (fn) => demoMode.subscribe(fn),
    () => demoMode.enabled,
    () => false,
  )
  return {
    enabled,
    divisor: enabled ? DIVISOR : 1,
    setEnabled: (on) => demoMode.setEnabled(on),
    toggle: () => demoMode.toggle(),
  }
}
