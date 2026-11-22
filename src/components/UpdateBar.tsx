import { useUpdate } from '../lib/updates'
import { Button } from './ui'

/** Shown only when a new version is ready and files are open, so reloading is the person's call. */
export function UpdateBar() {
  const { ready, apply, later } = useUpdate()
  if (!ready) return null
  return (
    <div role="status" className="glass pointer-events-auto fixed inset-x-3 bottom-3 z-50 flex flex-col gap-3 rounded-[var(--r-panel)] border border-[var(--glass-edge)] p-4 shadow-[var(--pop-shadow)] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-80">
      <div>
        <p className="font-semibold">A new version of Cornerfold is ready</p>
        <p className="mt-1 text-sm text-muted">Reloading closes your open files, so export what you need first.</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={later}>Later</Button>
        <Button variant="primary" onClick={apply}>
          Reload now
        </Button>
      </div>
    </div>
  )
}
