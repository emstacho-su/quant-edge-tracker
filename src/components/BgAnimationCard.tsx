import { useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  setBgConfig,
  useBgConfig,
  type BgStyle,
  type ColorMode,
  type RGBColor,
} from '@/lib/bg-config'

const BG_STYLES: { value: BgStyle; label: string; help: string }[] = [
  {
    value: 'glitter',
    label: 'Glitter (default)',
    help: 'WebGL sparkle field — soft animated points across the viewport.',
  },
  {
    value: 'flow-field',
    label: 'Flow field',
    help: 'Particle flow with cursor forcefield and color modes.',
  },
]

const COLOR_MODES: { value: ColorMode; label: string; help: string }[] = [
  {
    value: 'plain',
    label: 'Plain',
    help: 'White lights only. No proximity color logic.',
  },
  {
    value: 'rgb',
    label: 'RGB',
    help: 'Lights tint toward red, green, or blue elements as they pass nearby. Buttons and inputs are ignored.',
  },
  {
    value: 'custom',
    label: 'Custom',
    help: 'All lights tint toward a single user-defined color.',
  },
]

function rgbToHex({ r, g, b }: RGBColor): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function hexToRgb(hex: string): RGBColor | null {
  const s = hex.trim().replace(/^#/, '')
  const norm =
    s.length === 3
      ? s
          .split('')
          .map((c) => c + c)
          .join('')
      : s
  if (!/^[0-9a-fA-F]{6}$/.test(norm)) return null
  return {
    r: parseInt(norm.slice(0, 2), 16),
    g: parseInt(norm.slice(2, 4), 16),
    b: parseInt(norm.slice(4, 6), 16),
  }
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(255, Math.round(n)))
}

export function BgAnimationCard() {
  const config = useBgConfig()

  const hex = useMemo(() => rgbToHex(config.customColor), [config.customColor])

  const handleStyleChange = useCallback((style: BgStyle) => {
    setBgConfig({ style })
  }, [])

  const handleModeChange = useCallback((mode: ColorMode) => {
    setBgConfig({ colorMode: mode })
  }, [])

  const handleHexChange = useCallback((value: string) => {
    const rgb = hexToRgb(value)
    if (rgb) setBgConfig({ customColor: rgb })
  }, [])

  const handleChannelChange = useCallback(
    (channel: keyof RGBColor, value: string) => {
      const next = clampByte(Number(value))
      setBgConfig({
        customColor: { ...config.customColor, [channel]: next },
      })
    },
    [config.customColor],
  )

  const handlePicker = useCallback((value: string) => {
    const rgb = hexToRgb(value)
    if (rgb) setBgConfig({ customColor: rgb })
  }, [])

  const handleRadius = useCallback((value: string) => {
    const n = Number(value)
    if (Number.isFinite(n)) {
      setBgConfig({ forcefieldRadius: Math.max(0, Math.min(400, n)) })
    }
  }, [])

  const handleMobileToggle = useCallback((checked: boolean) => {
    setBgConfig({ mobileEnabled: checked })
  }, [])

  const activeHelp = COLOR_MODES.find((m) => m.value === config.colorMode)?.help ?? ''
  const activeStyleHelp = BG_STYLES.find((s) => s.value === config.style)?.help ?? ''
  const flowFieldEnabled = config.style === 'flow-field'

  return (
    <Card className="glass-card" data-glow="rgba(125,211,252,1)">
      <CardHeader>
        <CardTitle className="text-sm">Background Animation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-xs text-muted-foreground">
          Visual preferences for the ambient background. Saved on this device.
        </p>

        <div className="space-y-2">
          <Label htmlFor="bg-style">Background style</Label>
          <select
            id="bg-style"
            value={config.style}
            onChange={(e) => handleStyleChange(e.target.value as BgStyle)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs sm:max-w-sm"
          >
            {BG_STYLES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{activeStyleHelp}</p>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 p-3">
          <div className="space-y-1">
            <Label htmlFor="bg-mobile-enabled" className="text-sm">
              Show on mobile
            </Label>
            <p className="text-xs text-muted-foreground">
              Off by default on phones to save battery and keep scrolling smooth.
            </p>
          </div>
          <input
            id="bg-mobile-enabled"
            type="checkbox"
            checked={config.mobileEnabled}
            onChange={(e) => handleMobileToggle(e.target.checked)}
            className="size-5 cursor-pointer accent-primary"
          />
        </div>

        <div
          className={cn(
            'grid gap-4 sm:grid-cols-2',
            !flowFieldEnabled && 'pointer-events-none opacity-50',
          )}
          aria-disabled={!flowFieldEnabled}
        >
          <div className="space-y-2">
            <Label htmlFor="bg-color-mode">Color mode</Label>
            <select
              id="bg-color-mode"
              value={config.colorMode}
              onChange={(e) => handleModeChange(e.target.value as ColorMode)}
              disabled={!flowFieldEnabled}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs disabled:cursor-not-allowed"
            >
              {COLOR_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{activeHelp}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bg-forcefield">Cursor forcefield radius</Label>
            <div className="flex items-center gap-3">
              <input
                id="bg-forcefield"
                type="range"
                min={0}
                max={200}
                step={1}
                value={config.forcefieldRadius}
                onChange={(e) => handleRadius(e.target.value)}
                disabled={!flowFieldEnabled}
                className="flex-1 accent-primary"
              />
              <Input
                type="number"
                min={0}
                max={400}
                step={1}
                value={config.forcefieldRadius}
                onChange={(e) => handleRadius(e.target.value)}
                disabled={!flowFieldEnabled}
                className="w-20"
              />
              <span className="text-xs text-muted-foreground">px</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Circular zone around the pointer where lights are repelled. Set to 0 to disable.
            </p>
          </div>
        </div>

        {flowFieldEnabled && config.colorMode === 'custom' && (
          <div className="rounded-md border border-border/60 bg-background/40 p-4">
            <Label className="mb-3 block text-xs uppercase tracking-wider text-muted-foreground">
              Custom color
            </Label>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => handlePicker(e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded-md border border-border bg-transparent"
                  aria-label="Color picker"
                />
                <div
                  className="h-10 w-10 rounded-md border border-border"
                  style={{ background: hex }}
                  aria-hidden
                />
              </div>

              <div className="flex items-center gap-2">
                <Label htmlFor="bg-hex" className="text-xs text-muted-foreground">
                  Hex
                </Label>
                <Input
                  id="bg-hex"
                  type="text"
                  value={hex}
                  onChange={(e) => handleHexChange(e.target.value)}
                  className="w-28 font-mono uppercase"
                  spellCheck={false}
                />
              </div>

              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">RGB</Label>
                <Input
                  type="number"
                  min={0}
                  max={255}
                  value={config.customColor.r}
                  onChange={(e) => handleChannelChange('r', e.target.value)}
                  className="w-16"
                  aria-label="Red channel"
                />
                <Input
                  type="number"
                  min={0}
                  max={255}
                  value={config.customColor.g}
                  onChange={(e) => handleChannelChange('g', e.target.value)}
                  className="w-16"
                  aria-label="Green channel"
                />
                <Input
                  type="number"
                  min={0}
                  max={255}
                  value={config.customColor.b}
                  onChange={(e) => handleChannelChange('b', e.target.value)}
                  className="w-16"
                  aria-label="Blue channel"
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
