// Small form pieces shared by the tool panels.
import type { InputHTMLAttributes, ReactNode } from 'react'

export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-note`} role="alert" className="mt-2 flex items-start gap-2 text-sm font-medium">
          <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-hi" aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-note`} aria-live="polite" className="mt-2 text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      className={`h-12 w-full rounded-2xl border border-line bg-paper px-4 text-base outline-none focus:border-ink ${className}`}
      {...rest}
    />
  )
}

/** One choice out of a few, as a row of buttons. Arrow keys move between them. */
export function Choices<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
            if (!step) return
            e.preventDefault()
            const next = options[(i + step + options.length) % options.length]
            onChange(next.value)
            ;(e.currentTarget.parentElement?.children[(i + step + options.length) % options.length] as HTMLElement)?.focus()
          }}
          className={`h-10 rounded-full border px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ink ${o.value === value ? 'border-ink bg-ink text-white' : 'border-line hover:bg-desk-2'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
