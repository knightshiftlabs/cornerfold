import type { CSSProperties } from 'react'
import { Button, Sheet } from './ui'
import { Card, Row, Segmented, Slider, Swatches, Switch, Tiles } from './controls'
import { CHOICES, DEFAULTS, usePrefs, type Look } from '../lib/prefs'
import { tick } from '../lib/sound'

const THEMES = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'paper', label: 'Paper' },
] as const
const ACCENTS = [
  { value: 'indigo', label: 'Indigo', color: '#6b7bff' },
  { value: 'blue', label: 'Blue', color: '#0a84ff' },
  { value: 'violet', label: 'Violet', color: '#8e5cf0' },
  { value: 'pink', label: 'Pink', color: '#ff5c93' },
  { value: 'orange', label: 'Orange', color: '#ff8a3d' },
  { value: 'green', label: 'Green', color: '#30c48d' },
  { value: 'graphite', label: 'Graphite', color: '#8e93a4' },
] as const
const DESKS = [
  { value: 'graphite', label: 'Graphite' },
  { value: 'slate', label: 'Slate' },
  { value: 'linen', label: 'Linen' },
  { value: 'felt', label: 'Felt' },
] as const

// Miniatures use fixed colours on purpose: each shows what that choice looks like, whatever the current theme is.
const THEME_VIEW: Record<(typeof THEMES)[number]['value'], { desk: string; bar: string }> = {
  auto: { desk: 'linear-gradient(90deg,#e7e8ee 50%,#15171d 50%)', bar: 'rgb(120 124 140 / 0.55)' },
  light: { desk: '#e7e8ee', bar: '#ffffff' },
  dark: { desk: '#15171d', bar: 'rgb(255 255 255 / 0.14)' },
  midnight: { desk: '#000000', bar: 'rgb(255 255 255 / 0.1)' },
  paper: { desk: '#efe9dc', bar: '#fffdf7' },
}
const DESK_VIEW: Record<(typeof DESKS)[number]['value'], string> = {
  graphite: 'radial-gradient(#2a2d36,#0f1014)',
  slate: 'linear-gradient(#3b4252,#262b36)',
  linen: 'repeating-linear-gradient(45deg,#d9d5cb 0 2px,#cfcabe 2px 4px)',
  felt: '#1f3a2e',
}

const seg = <K extends keyof Look>(key: K, labels: Record<string, string>) => (CHOICES as unknown as Record<string, readonly string[]>)[key as string].map((v) => ({ value: v, label: labels[v] ?? v }))

export default function Appearance() {
  const look = usePrefs((s) => s.look)
  const set = usePrefs((s) => s.set)
  const reset = usePrefs((s) => s.reset)
  const close = () => usePrefs.getState().setOpen(false)
  const changed = (Object.keys(DEFAULTS) as (keyof Look)[]).some((k) => look[k] !== DEFAULTS[k])

  const S = <K extends keyof Look>(key: K, label: string, labels: Record<string, string>) => (
    <Segmented label={label} value={look[key] as string} options={seg(key, labels)} onChange={(v) => set(key, v as Look[K])} />
  )

  return (
    <Sheet
      wide
      title="Appearance"
      intro="Changes apply at once. They are kept on this device and nowhere else."
      onClose={close}
      footer={
        <>
          <Button onClick={reset} disabled={!changed} className="mr-auto">
            Reset to defaults
          </Button>
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Card title="Theme">
          <div className="p-4">
            <Tiles
              label="Theme"
              value={look.theme}
              options={THEMES}
              onChange={(v) => set('theme', v)}
              tile={(v) => (
                <span className="relative block h-16 w-24 overflow-hidden rounded-[9px]" style={{ background: THEME_VIEW[v].desk }}>
                  <span className="absolute inset-x-2 top-2 h-2.5 rounded" style={{ background: THEME_VIEW[v].bar }} />
                  {[12, 38, 64].map((x, i) => (
                    <span key={x} className="absolute top-[26px] h-7 w-5 rounded-[2px] bg-white shadow-[0_2px_4px_rgb(0_0_0/0.4)]" style={{ left: x, boxShadow: i === 2 ? '0 0 0 1.5px #6b7bff, 0 2px 4px rgb(0 0 0 / 0.4)' : undefined } as CSSProperties} />
                  ))}
                </span>
              )}
            />
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Colour and materials">
            <Row label="Accent">
              <Swatches label="Accent" value={look.accent} options={ACCENTS} onChange={(v) => set('accent', v)} />
            </Row>
            <Row label="Desk">
              <Tiles label="Desk" value={look.desk} options={DESKS} onChange={(v) => set('desk', v)} tile={(v) => <span className="block h-9 w-14 rounded-lg" style={{ background: DESK_VIEW[v] }} />} />
            </Row>
            <Row label="Paper" hint="Soft takes the glare off white pages in dark themes.">
              {S('paper', 'Paper', { bright: 'Bright', soft: 'Soft', warm: 'Warm' })}
            </Row>
            <Row label="Page shadows">{S('shadow', 'Page shadows', { flat: 'Flat', soft: 'Soft', lifted: 'Lifted' })}</Row>
            <Row label="Glass" hint="How blurred and see-through the panels are.">
              <Slider label="Glass" value={look.glass} onChange={(v) => set('glass', v)} />
            </Row>
          </Card>

          <Card title="Shape and space">
            <Row label="Selection" hint="How chosen pages look.">
              {S('select', 'Selection', { fold: 'Fold', check: 'Check', ring: 'Ring' })}
            </Row>
            <Row label="Corners">{S('corners', 'Corners', { sharp: 'Sharp', soft: 'Soft', round: 'Round' })}</Row>
            <Row label="Density">{S('density', 'Density', { compact: 'Compact', calm: 'Calm', airy: 'Airy' })}</Row>
            <Row label="Page size">
              <Slider label="Page size" value={look.size} onChange={(v) => set('size', v)} />
            </Row>
            <Row label="Text size">{S('text', 'Text size', { default: 'Default', large: 'Large', largest: 'Largest' })}</Row>
          </Card>
        </div>

        <Card title="Motion and feel">
          <Row label="Motion" hint="Calm halves every animation. A device set to reduce motion always wins.">
            {S('motion', 'Motion', { full: 'Full', calm: 'Calm', off: 'Off' })}
          </Row>
          <Row label="Higher contrast" hint="Stronger edges and text, plain panels.">
            <Switch label="Higher contrast" checked={look.contrast} onChange={(v) => set('contrast', v)} />
          </Row>
          <Row label="Keyboard hints" hint="The reminder of shortcuts at the bottom.">
            <Switch label="Keyboard hints" checked={look.hints} onChange={(v) => set('hints', v)} />
          </Row>
          <Row label="Tick sound" hint="A soft tick when a page lands. Off unless you want it.">
            <Switch
              label="Tick sound"
              checked={look.sound}
              onChange={(v) => {
                set('sound', v)
                if (v) tick()
              }}
            />
          </Row>
        </Card>
      </div>
    </Sheet>
  )
}
