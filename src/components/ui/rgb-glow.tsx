import { type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export type RgbGlowColor = 'red' | 'green' | 'blue' | 'yellow' | 'orange'

interface RgbGlowProps {
  /** Semantic color the background animation will tint nearby particles toward. */
  color: RgbGlowColor
  /** Optional class — by default the probe is absolutely positioned and
   *  fills its parent. Use this to constrain to a specific quadrant of a
   *  chart (e.g. top half = green positive bars, bottom half = red negative). */
  className?: string
  style?: CSSProperties
  /** Hide the probe from screen readers — it has no semantic meaning. */
  ariaHidden?: boolean
}

/**
 * Invisible "probe" that tags a region of the page so the background light
 * animation tints particles toward `color` whenever the user is in RGB
 * color mode. Has no visual presence and is completely transparent to
 * pointer events.
 *
 * Use this for charts, visualizations, or any rendered element that the
 * animation engine cannot directly inspect (e.g. SVG strokes painted by
 * Recharts). Place it inside the chart container and either fill (default)
 * or constrain via className (e.g. `top-0 h-1/2` for the upper half of a
 * bar chart that has positive bars on top, negative on the bottom).
 *
 * For static UI text whose color is meaningful (P/L numbers, ROI cells),
 * prefer adding `data-rgb-glow="green|red|..."` directly to that element
 * instead of using this component.
 */
export function RgbGlow({
  color,
  className,
  style,
  ariaHidden = true,
}: RgbGlowProps) {
  return (
    <div
      data-rgb-glow={color}
      aria-hidden={ariaHidden}
      className={cn('pointer-events-none absolute inset-0', className)}
      style={style}
    />
  )
}
