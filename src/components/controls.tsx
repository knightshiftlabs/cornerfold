import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

/** A row inside a settings card: a label with an optional line of explanation, and the control on the right. */
export function Row({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 [&+&]:border-t [&+&]:border-line">
      <div className="min-w-0 flex-1 basis-40">
        <div id={id} className="font-medium leading-tight">
          {label}
        </div>
        {hint && <div className="mt-0.5 text-xs leading-snug text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function Card({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-[var(--r-card)] bg-fg/[0.05] shadow-[inset_0_1px_0_var(--edge),0_0_0_1px_var(--line)]">
      {children}
    </section>
  )
}

/** Arrow keys move through a group the way the platform's own radio buttons do: one tab stop, arrows to change. */
function useRadioKeys(count: number, index: number, choose: (i: number) => void) {
  const root = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (index + step + count) % count
    choose(next)
    requestAnimationFrame(() => root.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus())
  }
  return { root, onKeyDown }
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  const index = options.findIndex((o) => o.value === value)
  const { root, onKeyDown } = useRadioKeys(options.length, index, (i) => onChange(options[i].value))
  return (
    <div ref={root} role="radiogroup" aria-label={label} className="seg" onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className="switch focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" />
}

export function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <input type="range" min={0} max={100} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} className="range w-36" style={{ '--p': `${value}%` } as CSSProperties} />
}

/** Round colour chips, one choice from a handful. */
export function Swatches<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string; color: string }[]; onChange: (v: T) => void }) {
  const index = options.findIndex((o) => o.value === value)
  const { root, onKeyDown } = useRadioKeys(options.length, index, (i) => onChange(options[i].value))
  return (
    <div ref={root} role="radiogroup" aria-label={label} className="flex gap-2.5 p-1" onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.label}
          title={o.label}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className="swatch focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${o.color} 78%, #fff), ${o.color})` }}
        />
      ))}
    </div>
  )
}

/** Larger picture tiles (themes, desks): a miniature of the choice with its name beneath. */
export function Tiles<T extends string>({ label, value, options, onChange, tile }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; tile: (v: T) => ReactNode }) {
  const index = options.findIndex((o) => o.value === value)
  const { root, onKeyDown } = useRadioKeys(options.length, index, (i) => onChange(options[i].value))
  return (
    <div ref={root} role="radiogroup" aria-label={label} className="flex flex-wrap justify-between gap-3" onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className="group flex flex-col items-center gap-1.5 rounded-xl p-1 text-xs text-muted outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink aria-checked:font-semibold aria-checked:text-fg"
        >
          <span className="block rounded-[10px] transition-shadow group-aria-checked:shadow-[0_0_0_2px_var(--desk),0_0_0_4px_var(--ink)] shadow-[0_0_0_1px_var(--line)]">{tile(o.value)}</span>
          {o.label}
        </button>
      ))}
    </div>
  )
}
