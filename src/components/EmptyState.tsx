import type { CSSProperties } from 'react'
import { Plus } from 'lucide-react'
import { MOD, pickFiles } from '../lib/actions'
import { Button } from './ui'

export function EmptyState() {
  return (
    <section className="grid min-h-[calc(100dvh-4rem)] items-center px-6 py-16 sm:px-12">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div>
          <h1 className="headline max-w-[11ch]">Drop PDFs and images anywhere.</h1>
          <p className="mt-7 max-w-[46ch] text-lg leading-relaxed text-muted sm:text-xl">
            Merge, split, reorder and rotate pages. Everything happens on this device, nothing is uploaded, and it still works
            with your Wi‑Fi off.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button variant="primary" size="lg" onClick={pickFiles}>
              <Plus />
              Choose files
            </Button>
            <span className="text-muted">
              or press <kbd>{MOD}</kbd> <kbd>O</kbd>, or paste a screenshot
            </span>
          </div>
        </div>
        <PaperStack />
      </div>
    </section>
  )
}

/** A small stack of sheets on the desk. It's also a big target that opens the file picker. */
function PaperStack() {
  const sheets = [
    { cls: 'is-back', delay: 0 },
    { cls: 'is-middle', delay: 70 },
    { cls: 'is-front', delay: 140 },
  ]
  return (
    <button type="button" onClick={pickFiles} aria-label="Choose files" className="stack hidden lg:block">
      {sheets.map(({ cls, delay }) => (
        <span key={cls} className="stack-slot sheet-enter" style={{ '--d': `${200 + delay}ms`, '--tilt': '0deg' } as CSSProperties}>
          <span className={`stack-sheet ${cls}`}>
            <span className="ln t" />
            <span className="ln" />
            <span className="ln" style={{ width: '88%' }} />
            {cls === 'is-front' && <span className="pic" />}
            <span className="ln" />
            <span className="ln" style={{ width: '72%' }} />
            <span className="ln" style={{ width: '94%' }} />
            <span className="ln" style={{ width: '60%' }} />
          </span>
        </span>
      ))}
    </button>
  )
}
