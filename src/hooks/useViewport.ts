import { useSyncExternalStore } from 'react'

/**
 * Tailwind v4 default breakpoints — keep in sync with `tailwind.config.*` /
 * `@theme`.
 */
const MOBILE_QUERY = '(max-width: 639.98px)' // <sm
const DESKTOP_QUERY = '(min-width: 1024px)' // >=lg

interface ViewportSnapshot {
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
}

const SSR_SNAPSHOT: ViewportSnapshot = {
  isMobile: false,
  isTablet: false,
  isDesktop: true,
}

let cached: ViewportSnapshot | null = null

function read(): ViewportSnapshot {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return SSR_SNAPSHOT
  }
  const isMobile = window.matchMedia(MOBILE_QUERY).matches
  const isDesktop = window.matchMedia(DESKTOP_QUERY).matches
  const isTablet = !isMobile && !isDesktop
  if (
    cached &&
    cached.isMobile === isMobile &&
    cached.isTablet === isTablet &&
    cached.isDesktop === isDesktop
  ) {
    return cached
  }
  cached = { isMobile, isTablet, isDesktop }
  return cached
}

function subscribe(fn: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mobileMql = window.matchMedia(MOBILE_QUERY)
  const desktopMql = window.matchMedia(DESKTOP_QUERY)
  const onChange = () => {
    cached = null
    fn()
  }
  mobileMql.addEventListener('change', onChange)
  desktopMql.addEventListener('change', onChange)
  return () => {
    mobileMql.removeEventListener('change', onChange)
    desktopMql.removeEventListener('change', onChange)
  }
}

export function useViewport(): ViewportSnapshot {
  return useSyncExternalStore(subscribe, read, () => SSR_SNAPSHOT)
}
