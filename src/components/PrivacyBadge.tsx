import { useEffect, useRef, useState } from 'react'
import { ShieldCheck, WifiOff } from 'lucide-react'
import { reportHref } from '../lib/report'

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
        className="btn-ghost inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[0.8rem] font-semibold text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <Icon className="size-4 text-link" aria-hidden="true" />
        <span className="hidden sm:inline">{label}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Your privacy"
          className="toast-in-up absolute left-0 top-11 z-50 w-[min(20rem,calc(100vw-2rem))] glass rounded-2xl p-4 text-sm"
        >
          <p className="font-semibold">Your files stay here</p>
          <p className="mt-1.5 leading-relaxed text-muted">
            Cornerfold works entirely inside this browser tab. Your files are never uploaded, and closing the tab clears them from memory.
            {!online && ' Right now you’re offline, and everything still works.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <a href="/privacy.html#check" className="font-semibold text-link hover:underline">
              Check it yourself
            </a>
            <a href={reportHref(__APP_VERSION__, navigator.userAgent)} className="font-semibold text-link hover:underline">
              Report a problem
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
