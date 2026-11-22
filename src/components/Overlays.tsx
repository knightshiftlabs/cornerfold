import type { CSSProperties } from 'react'
import { LayoutGrid } from 'lucide-react'
import { MOD } from '../lib/actions'
import { usePrefs } from '../lib/prefs'

export function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 bg-desk/80 backdrop-blur-sm">
      <div className="absolute inset-3 grid place-items-center rounded-[28px] border-[3px] border-dashed border-ink sm:inset-5">
        <div className="text-center">
          <p className="headline text-link">Drop to add</p>
          <p className="mt-4 text-lg font-medium text-muted">It stays on this device.</p>
        </div>
      </div>
    </div>
  )
}

/** The dock: page size, and a reminder of the keys. Phones and tablets have no keyboard, so only the size shows there. */
export function Dock() {
  const hints = usePrefs((s) => s.look.hints)
  const size = usePrefs((s) => s.look.size)
  const set = usePrefs((s) => s.set)
  return (
    <div className="glass fixed bottom-5 left-1/2 z-30 hidden w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-5 whitespace-nowrap rounded-full py-2 pl-5 pr-6 text-xs text-muted lg:flex [@media(pointer:coarse)]:hidden">
      <label className="flex items-center gap-3">
        <span className="sr-only">Page size</span>
        <LayoutGrid className="size-3.5" aria-hidden="true" />
        <input type="range" min={0} max={100} value={size} onChange={(e) => set('size', Number(e.target.value))} className="range w-36" style={{ '--p': `${size}%` } as CSSProperties} aria-label="Page size" />
        <LayoutGrid className="size-[18px]" aria-hidden="true" />
      </label>
      {hints && (
        <>
          <span className="h-5 w-px bg-line" aria-hidden="true" />
          <p className="pointer-events-none flex items-center gap-4">
            <span>Drag to reorder</span>
            <span>
              <kbd>R</kbd> rotate
            </span>
            <span>
              <kbd>⌫</kbd> delete
            </span>
            <span>
              <kbd>Shift</kbd> click to select a range
            </span>
            <span>
              <kbd>{MOD}</kbd> <kbd>Z</kbd> undo
            </span>
          </p>
        </>
      )}
    </div>
  )
}
