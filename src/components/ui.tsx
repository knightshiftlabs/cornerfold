import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost'; size?: 'md' | 'lg' }

export function Button({ variant = 'ghost', size = 'md', className = '', ...rest }: Props) {
  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold rounded-[var(--r-ctl)] select-none transition-[background-color,transform,filter] duration-100 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink [&_svg]:size-[1.1em] [&_svg]:shrink-0'
  const sizes = size === 'lg' ? 'h-14 px-7 text-lg' : 'h-9 px-3.5 text-[0.9rem]'
  const look = variant === 'primary' ? 'btn-primary' : 'btn-ghost text-fg'
  return <button type="button" className={`${base} ${sizes} ${look} ${className}`} {...rest} />
}

export function IconButton({ label, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid place-items-center size-9 rounded-[var(--r-ctl)] text-fg hover:bg-fg/10 active:scale-[0.94] transition-[background-color,transform] duration-100 disabled:opacity-35 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink [&_svg]:size-[18px] ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/** On small screens with a busy toolbar, `compact` shows just the mark. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 64 64" className="size-7" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="var(--ink)" />
        <path d="M19 13h18l10 10v28H19z" fill="#fff" />
        <path d="M37 13v10h10z" fill="var(--hi)" />
      </svg>
      <span className={`wordmark ${compact ? 'hidden sm:inline' : ''}`}>cornerfold</span>
    </span>
  )
}

/**
 * The shell every tool panel shares: a dialog that takes focus when it opens, keeps Tab inside it, and
 * closes with Escape, its close button, or a click outside. On phones it rises from the bottom.
 */
export function Sheet({ title, intro, onClose, children, footer, wide }: { title: string; intro?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = panel.current!
    ;(el.querySelector<HTMLElement>('[data-autofocus]') ?? el).focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return e.preventDefault(), onClose()
      if (e.key !== 'Tab') return
      const items = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, a[href]')]
      if (!items.length) return
      const [first, last] = [items[0], items[items.length - 1]]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) e.preventDefault(), last.focus()
      else if (!e.shiftKey && document.activeElement === last) e.preventDefault(), first.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-scrim backdrop-blur-[3px] sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className={`toast-in-up glass max-h-[92dvh] w-full overflow-y-auto rounded-t-[var(--r-panel)] p-5 outline-none sm:rounded-[var(--r-panel)] sm:p-7 ${wide ? 'max-w-4xl' : 'max-w-lg'}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="sheet-title" className="text-2xl font-semibold tracking-tight">
              {title}
            </h2>
            {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1 shrink-0">
            <X />
          </IconButton>
        </div>
        <div className="mt-5">{children}</div>
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}
