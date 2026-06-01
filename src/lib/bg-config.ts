import { useSyncExternalStore } from 'react'

export type ColorMode = 'plain' | 'rgb' | 'custom'
export type BgStyle = 'glitter' | 'flow-field'

export interface RGBColor {
  r: number
  g: number
  b: number
}

export interface BgConfig {
  /** Which background visual to render. Glitter is the default. */
  style: BgStyle
  /** Color-mode logic for the flow-field engine (no effect on glitter). */
  colorMode: ColorMode
  customColor: RGBColor
  forcefieldRadius: number
  /**
   * When true, render the background on mobile viewports too. Defaults to
   * false because animated WebGL/Canvas backgrounds are expensive on mid-range
   * phones. Phase 02 / TBD-1.
   */
  mobileEnabled: boolean
}

const STORAGE_KEY = 'qet:bg-config:v2'

const DEFAULT_CONFIG: BgConfig = {
  style: 'glitter',
  colorMode: 'plain',
  customColor: { r: 168, g: 162, b: 158 },
  forcefieldRadius: 60,
  mobileEnabled: false,
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(255, Math.round(n)))
}

function sanitize(input: unknown): BgConfig {
  if (!input || typeof input !== 'object') return { ...DEFAULT_CONFIG }
  const raw = input as Partial<BgConfig> & {
    customColor?: Partial<RGBColor>
  }
  const style: BgStyle = raw.style === 'flow-field' ? 'flow-field' : 'glitter'
  const colorMode: ColorMode =
    raw.colorMode === 'rgb' || raw.colorMode === 'custom'
      ? raw.colorMode
      : 'plain'
  const customColor: RGBColor = {
    r: clampByte(raw.customColor?.r ?? DEFAULT_CONFIG.customColor.r),
    g: clampByte(raw.customColor?.g ?? DEFAULT_CONFIG.customColor.g),
    b: clampByte(raw.customColor?.b ?? DEFAULT_CONFIG.customColor.b),
  }
  const radiusRaw =
    typeof raw.forcefieldRadius === 'number' ? raw.forcefieldRadius : DEFAULT_CONFIG.forcefieldRadius
  const forcefieldRadius = Math.max(0, Math.min(400, radiusRaw))
  const mobileEnabled =
    typeof raw.mobileEnabled === 'boolean' ? raw.mobileEnabled : DEFAULT_CONFIG.mobileEnabled
  return { style, colorMode, customColor, forcefieldRadius, mobileEnabled }
}

function load(): BgConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_CONFIG }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    return sanitize(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function persist(config: BgConfig): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // ignore quota / privacy mode
  }
}

let current: BgConfig = load()
const listeners = new Set<() => void>()

export function getBgConfig(): BgConfig {
  return current
}

export function setBgConfig(patch: Partial<BgConfig>): void {
  const next = sanitize({ ...current, ...patch })
  if (
    next.style === current.style &&
    next.colorMode === current.colorMode &&
    next.forcefieldRadius === current.forcefieldRadius &&
    next.mobileEnabled === current.mobileEnabled &&
    next.customColor.r === current.customColor.r &&
    next.customColor.g === current.customColor.g &&
    next.customColor.b === current.customColor.b
  ) {
    return
  }
  current = next
  persist(current)
  listeners.forEach((fn) => fn())
}

export function subscribeBgConfig(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useBgConfig(): BgConfig {
  return useSyncExternalStore(subscribeBgConfig, getBgConfig, () => DEFAULT_CONFIG)
}
