import { Plus } from 'lucide-react'
import { MOD, pickFiles } from '../lib/actions'
import { Button } from './ui'

export function EmptyState() {
  return (
    <section className="grid min-h-[calc(100dvh-4rem)] items-center px-6 py-16 sm:px-12">
      <div className="mx-auto w-full max-w-5xl">
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
    </section>
  )
}
