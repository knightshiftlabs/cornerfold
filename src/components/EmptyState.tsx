import type { CSSProperties } from 'react'
import { CloudOff, EyeOff, Plus, UserX, WifiOff } from 'lucide-react'
import { MOD, pickFiles } from '../lib/actions'
import { reportHref } from '../lib/report'
import { Button } from './ui'

export function EmptyState() {
  return (
    <section className="flex min-h-[calc(100dvh-4rem)] flex-col px-6 sm:px-12">
      <div className="mx-auto grid w-full max-w-6xl flex-1 content-center items-center gap-5 py-5 [@media(max-height:700px)]:gap-3 [@media(max-height:700px)]:py-3 sm:gap-8 sm:py-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16 lg:py-16">
        <div>
          <h1 className="headline max-w-[13ch]">PDF tools that never see your files.</h1>
          <p className="mt-4 max-w-[46ch] text-base leading-relaxed text-muted sm:mt-7 sm:text-xl">
            Merge, split, compress, reorder and rotate pages. Everything runs right here on your device, so your documents are never
            uploaded, stored or seen by anyone else.
          </p>
          <ul className="mt-5 grid max-w-md grid-cols-[auto_auto] justify-start gap-x-6 gap-y-2 text-[0.9rem] font-medium max-[380px]:gap-x-4 max-[380px]:text-[0.84rem] sm:mt-7 sm:gap-y-2.5 sm:text-[0.95rem]" aria-label="Privacy">
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
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 sm:mt-10">
            <Button variant="primary" size="lg" onClick={pickFiles}>
              <Plus />
              Choose files
            </Button>
            <span className="text-muted [@media(pointer:coarse)]:hidden">
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
        <a href="/about.html" className="hover:text-fg">
          About
        </a>
        <a href="/terms.html" className="hover:text-fg">
          Terms
        </a>
        <a href="/licenses.txt" className="hover:text-fg">
          Open-source licenses
        </a>
        <a href="mailto:hello@cornerfold.org" className="hover:text-fg">
          Contact
        </a>
        <a href={reportHref(__APP_VERSION__, navigator.userAgent)} className="hover:text-fg">
          Report a problem
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
    <button type="button" onClick={pickFiles} aria-label="Choose files" className="stack order-first lg:order-none">
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
