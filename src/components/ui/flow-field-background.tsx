import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  getBgConfig,
  subscribeBgConfig,
  type BgConfig,
  type RGBColor,
} from '@/lib/bg-config'

interface NeuralBackgroundProps {
  className?: string
  /** Trail opacity 0-1. Lower = longer trails. */
  trailOpacity?: number
  /** Particle count. */
  particleCount?: number
  /** Visual scale applied to motion + draw size. */
  scale?: number
}

const BASE_SPEED_MULTIPLIER = 0.8 // global 20% reduction (tunable here)
const FORCEFIELD_PUSH_GAIN = 0.55
const INTERACTIVE_SELECTOR =
  'button, input, select, textarea, a, [role="button"], [data-slot="button"]'

const RGB_TARGETS = {
  r: { r: 248, g: 113, b: 113 },
  g: { r: 110, g: 231, b: 183 },
  b: { r: 125, g: 211, b: 252 },
} as const

const PLAIN_COLOR: RGBColor = { r: 245, g: 245, b: 244 }

interface GlowTarget {
  cx: number
  cy: number
  halfMax: number
  color: RGBColor
}

function parseColorString(str: string): RGBColor | null {
  const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (!m) return null
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
  }
}

function snapToRgbChannel(color: RGBColor): RGBColor {
  const { r, g, b } = color
  if (r >= g && r >= b) return RGB_TARGETS.r
  if (g >= r && g >= b) return RGB_TARGETS.g
  return RGB_TARGETS.b
}

interface ParticleState {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  // smooth-path personality
  seedX: number
  seedY: number
  noiseScale: number
  noiseFreq: number
  driftAngle: number
  speedFactor: number
  // current rendered color (lerped each frame)
  cr: number
  cg: number
  cb: number
}

export default function NeuralBackground({
  className,
  trailOpacity = 0.15,
  particleCount = 600,
  scale = 1,
}: NeuralBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const configRef = useRef<BgConfig>(getBgConfig())

  useEffect(() => {
    const unsubscribe = subscribeBgConfig(() => {
      configRef.current = getBgConfig()
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = container.clientWidth
    let height = container.clientHeight
    let particles: ParticleState[] = []
    let rafId = 0
    const mouse = { x: -10000, y: -10000, active: false }

    let glowTargets: GlowTarget[] = []
    let lastGlowScan = 0

    const scanGlowTargets = (now: number, mode: BgConfig['colorMode']) => {
      // Only RGB mode needs proximity targets — skip work otherwise.
      if (mode !== 'rgb') {
        glowTargets = []
        return
      }
      if (now - lastGlowScan < 500) return
      lastGlowScan = now
      const els = document.querySelectorAll<HTMLElement>('[data-glow]')
      const next: GlowTarget[] = []
      els.forEach((el) => {
        if (el.matches(INTERACTIVE_SELECTOR)) return
        if (el.closest(INTERACTIVE_SELECTOR)) return
        const raw = el.getAttribute('data-glow')
        if (!raw) return
        const parsed = parseColorString(raw)
        if (!parsed) return
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        next.push({
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
          halfMax: Math.max(rect.width, rect.height) / 2,
          color: snapToRgbChannel(parsed),
        })
      })
      glowTargets = next
    }

    const makeParticle = (): ParticleState => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: 0,
      vy: 0,
      age: 0,
      life: 200 + Math.random() * 400,
      seedX: Math.random() * 1000,
      seedY: Math.random() * 1000,
      noiseScale: 0.0015 + Math.random() * 0.0035,
      noiseFreq: 0.0002 + Math.random() * 0.0006,
      driftAngle: Math.random() * Math.PI * 2,
      speedFactor: 0.7 + Math.random() * 0.6,
      cr: PLAIN_COLOR.r,
      cg: PLAIN_COLOR.g,
      cb: PLAIN_COLOR.b,
    })

    const resetParticle = (p: ParticleState) => {
      p.x = Math.random() * width
      p.y = Math.random() * height
      p.vx = 0
      p.vy = 0
      p.age = 0
      p.life = 200 + Math.random() * 400
      p.driftAngle = Math.random() * Math.PI * 2
      p.speedFactor = 0.7 + Math.random() * 0.6
    }

    const init = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      particles = Array.from({ length: particleCount }, makeParticle)
    }

    const computeTargetColor = (p: ParticleState, cfg: BgConfig): RGBColor => {
      if (cfg.colorMode === 'plain') return PLAIN_COLOR
      if (cfg.colorMode === 'custom') return cfg.customColor

      // RGB mode: blend toward nearest data-glow targets.
      let r = PLAIN_COLOR.r
      let g = PLAIN_COLOR.g
      let b = PLAIN_COLOR.b
      const radius = 220
      for (const t of glowTargets) {
        const dx = t.cx - p.x
        const dy = t.cy - p.y
        const d = Math.sqrt(dx * dx + dy * dy)
        const distToBox = Math.max(0, d - t.halfMax)
        if (distToBox < radius) {
          const w = 1 - distToBox / radius
          r += (t.color.r - r) * w
          g += (t.color.g - g) * w
          b += (t.color.b - b) * w
        }
      }
      return { r, g, b }
    }

    const step = (timestamp: number) => {
      const cfg = configRef.current
      scanGlowTargets(timestamp, cfg.colorMode)

      ctx.fillStyle = `rgba(0, 0, 0, ${trailOpacity})`
      ctx.fillRect(0, 0, width, height)

      const t = timestamp
      const radius = cfg.forcefieldRadius

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]

        // Smooth, varied flow: combine slow time-evolving sins with a
        // position-based field. Each particle has unique seeds.
        const angle =
          Math.sin(t * p.noiseFreq + p.seedX) * Math.PI +
          Math.cos(t * p.noiseFreq * 0.7 + p.seedY) * Math.PI +
          (Math.cos(p.x * p.noiseScale) + Math.sin(p.y * p.noiseScale)) * Math.PI * 0.5 +
          p.driftAngle * 0.05

        const force = 0.085 * BASE_SPEED_MULTIPLIER * scale * p.speedFactor
        p.vx += Math.cos(angle) * force
        p.vy += Math.sin(angle) * force

        // Cursor forcefield — smooth radial push, no teleport.
        if (mouse.active && radius > 0) {
          const dx = p.x - mouse.x
          const dy = p.y - mouse.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < radius) {
            const safeDist = dist || 0.001
            const nx = dx / safeDist
            const ny = dy / safeDist
            const penetration = (radius - dist) / radius
            // Outward push, scales with depth into the field.
            const push = penetration * FORCEFIELD_PUSH_GAIN
            p.vx += nx * push
            p.vy += ny * push
            // Cancel inward velocity component so particle can't bore through.
            const vDotN = p.vx * nx + p.vy * ny
            if (vDotN < 0) {
              p.vx -= vDotN * nx
              p.vy -= vDotN * ny
            }
          }
        }

        // Color blend
        const target = computeTargetColor(p, cfg)
        p.cr += (target.r - p.cr) * 0.08
        p.cg += (target.g - p.cg) * 0.08
        p.cb += (target.b - p.cb) * 0.08

        // Integrate
        p.x += p.vx
        p.y += p.vy
        p.vx *= 0.965
        p.vy *= 0.965

        // Hard floor: post-integration safety clamp out of forcefield.
        if (mouse.active && radius > 0) {
          const dx = p.x - mouse.x
          const dy = p.y - mouse.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < radius) {
            const safeDist = dist || 0.001
            p.x = mouse.x + (dx / safeDist) * radius
            p.y = mouse.y + (dy / safeDist) * radius
          }
        }

        // Age + recycle
        p.age++
        if (p.age > p.life) resetParticle(p)

        // Wrap
        if (p.x < 0) p.x = width
        else if (p.x > width) p.x = 0
        if (p.y < 0) p.y = height
        else if (p.y > height) p.y = 0

        // Draw — fade-in / fade-out triangle over lifetime.
        const lifeRatio = p.age / p.life
        const alpha = 1 - Math.abs(lifeRatio - 0.5) * 2
        ctx.fillStyle = `rgba(${Math.round(p.cr)}, ${Math.round(p.cg)}, ${Math.round(p.cb)}, ${alpha})`
        ctx.fillRect(p.x, p.y, 1.5 * scale, 1.5 * scale)
      }

      rafId = requestAnimationFrame(step)
    }

    const handleResize = () => {
      width = container.clientWidth
      height = container.clientHeight
      init()
    }

    const handleMouseMove = (e: MouseEvent) => {
      // Container is fixed at (0,0) so client coords map directly.
      mouse.x = e.clientX
      mouse.y = e.clientY
      mouse.active = true
    }

    const handleMouseLeave = () => {
      mouse.active = false
      mouse.x = -10000
      mouse.y = -10000
    }

    init()
    rafId = requestAnimationFrame(step)
    window.addEventListener('resize', handleResize)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseleave', handleMouseLeave)
    document.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseleave', handleMouseLeave)
      document.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [trailOpacity, particleCount, scale])

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full h-full bg-black overflow-hidden', className)}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  )
}
