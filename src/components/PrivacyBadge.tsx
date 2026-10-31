import { useEffect, useRef, useState } from 'react'
import { ShieldCheck, WifiOff } from 'lucide-react'

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

/** A live reminder of where the files are, which becomes proof when the connection drops. */
export function PrivacyBadge() {
  const online = useOnline()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const Icon = online ? ShieldCheck : WifiOff
  const label = online ? 'On this device' : 'Offline, still working'

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${label}. About your privacy`}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-2.5 text-[0.8rem] font-semibold text-fg hover:bg-desk-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <Icon className="size-4 text-ink" aria-hidden="true" />
        <span className="hidden sm:inline">{label}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Your privacy"
          className="toast-in-up absolute left-0 top-11 z-50 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-line bg-desk p-4 text-sm shadow-[0_16px_40px_-12px_rgb(16_24_40/0.45)]"
        >
          <p className="font-semibold">Your files stay here</p>
          <p className="mt-1.5 leading-relaxed text-muted">
            Cornerfold works entirely inside this browser tab. Your files are never uploaded, and closing the tab clears them from memory.
            {!online && ' Right now you’re offline, and everything still works.'}
          </p>
          <a href="/privacy.html#check" className="mt-3 inline-block font-semibold text-ink hover:underline">
            Check it yourself
          </a>
        </div>
      )}
    </div>
  )
}
