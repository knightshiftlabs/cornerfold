import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost'; size?: 'md' | 'lg' }

export function Button({ variant = 'ghost', size = 'md', className = '', ...rest }: Props) {
  const base =
    'inline-flex items-center justify-center gap-2 font-semibold rounded-full select-none transition-[background-color,transform] duration-100 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink [&_svg]:size-[1.1em] [&_svg]:shrink-0'
  const sizes = size === 'lg' ? 'h-14 px-7 text-lg' : 'h-10 px-4 text-[0.95rem]'
  const look = variant === 'primary' ? 'bg-ink text-white hover:bg-ink-press' : 'text-fg hover:bg-desk-2'
  return <button type="button" className={`${base} ${sizes} ${look} ${className}`} {...rest} />
}

export function IconButton({ label, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid place-items-center size-10 rounded-full text-fg hover:bg-desk-2 active:scale-[0.94] transition-[background-color,transform] duration-100 disabled:opacity-35 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink [&_svg]:size-[18px] ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 64 64" className="size-7" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="var(--ink)" />
        <path d="M19 13h18l10 10v28H19z" fill="#fff" />
        <path d="M37 13v10h10z" fill="var(--hi)" />
      </svg>
      <span className="wordmark">cornerfold</span>
    </span>
  )
}
