import { useEffect, useRef, useState } from 'react'

/**
 * Tracks whether the window has scrolled past `threshold` pixels.
 *
 * Uses hysteresis: once active, it stays active until the user scrolls back
 * above `threshold - deadband`. Without this, momentum / rubber-band scrolling
 * near the boundary rapidly flips the value and makes scroll-reactive UI (the
 * condensing header) flicker. Scroll handling is throttled with rAF so we read
 * `scrollY` at most once per frame.
 */
export function useScroll(threshold: number, deadband = 8): boolean {
  const [scrolled, setScrolled] = useState(() =>
    typeof window !== 'undefined' ? window.scrollY > threshold : false,
  )
  const scrolledRef = useRef(scrolled)
  scrolledRef.current = scrolled

  useEffect(() => {
    let frame = 0

    const evaluate = () => {
      frame = 0
      const y = window.scrollY
      // Asymmetric thresholds = deadband. When on, require dropping below the
      // lower bound to turn off; when off, require crossing the upper bound.
      const next = scrolledRef.current ? y > threshold - deadband : y > threshold
      if (next !== scrolledRef.current) setScrolled(next)
    }

    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(evaluate)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    evaluate() // sync to current position on mount

    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [threshold, deadband])

  return scrolled
}
