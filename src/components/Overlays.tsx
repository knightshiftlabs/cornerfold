import { MOD } from '../lib/actions'

export function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 bg-desk/80 backdrop-blur-sm">
      <div className="absolute inset-3 grid place-items-center rounded-[28px] border-[3px] border-dashed border-ink sm:inset-5">
        <div className="text-center">
          <p className="headline text-ink">Drop to add</p>
          <p className="mt-4 text-lg font-medium text-muted">It stays on this device.</p>
        </div>
      </div>
    </div>
  )
}

export function Hints() {
  return (
    <p className="pointer-events-none fixed bottom-5 left-8 hidden items-center gap-5 text-xs text-muted lg:flex [@media(pointer:coarse)]:hidden">
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
  )
}
