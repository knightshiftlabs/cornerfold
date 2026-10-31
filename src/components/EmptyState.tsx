import type { CSSProperties } from 'react'
import { CloudOff, EyeOff, Plus, UserX, WifiOff } from 'lucide-react'
import { MOD, pickFiles } from '../lib/actions'
import { Button } from './ui'

export function EmptyState() {
  return (
    <section className="flex min-h-[calc(100dvh-4rem)] flex-col px-6 sm:px-12">
      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-16 py-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div>
          <h1 className="headline max-w-[13ch]">PDF tools that never see your files.</h1>
          <p className="mt-7 max-w-[46ch] text-lg leading-relaxed text-muted sm:text-xl">
            Merge, split, compress, reorder and rotate pages. Everything runs right here on your device, so your documents are never
            uploaded, stored or seen by anyone else.
          </p>
          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2.5 text-[0.95rem] font-medium" aria-label="Privacy">
            {[
              [CloudOff, 'Nothing uploaded'],
              [WifiOff, 'Works offline'],
              [EyeOff, 'No tracking or ads'],
              [UserX, 'No account'],
            ].map(([Icon, label]) => {
              const I = Icon as typeof CloudOff
              return (
                <li key={label as string} className="inline-flex items-center gap-2">
                  <I className="size-[18px] text-ink" aria-hidden="true" />
                  {label as string}
                </li>
              )
            })}
          </ul>
          <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button variant="primary" size="lg" onClick={pickFiles}>
              <Plus />
              Choose files
            </Button>
            <span className="text-muted">
              or drop them anywhere, press <kbd>{MOD}</kbd> <kbd>O</kbd>, or paste a screenshot
            </span>
          </div>
        </div>
        <PaperStack />
      </div>
      <footer className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-6 gap-y-1 pb-6 text-sm text-muted">
        <a href="/changes.html" className="hover:text-fg">
          Cornerfold {__APP_VERSION__}
        </a>
        <a href="/terms.html" className="hover:text-fg">
          Terms
        </a>
        <a href="/licenses.txt" className="hover:text-fg">
          Open-source licenses
        </a>
        <a href="mailto:sinhautkarsh.1@gmail.com" className="hover:text-fg">
          Contact
        </a>
      </footer>
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
