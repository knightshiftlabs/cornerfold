import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, Check, LoaderCircle, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { runJob, type JobOptions } from '../lib/engine'
import { baseName, download, formatBytes, parseSize, targets } from '../lib/actions'
import { Button, IconButton } from './ui'

type Choice = 'light' | 'balanced' | 'smallest' | 'target'
type Result = { bytes: Uint8Array; size: number; met: boolean } | 'working' | 'failed'

const LEVELS: { id: Exclude<Choice, 'target'>; title: string; hint: string }[] = [
  { id: 'light', title: 'Light', hint: 'Images stay sharp. Modest savings.' },
  { id: 'balanced', title: 'Balanced', hint: 'Good for email and sharing. Recommended.' },
  { id: 'smallest', title: 'Smallest', hint: 'For tight upload limits. Images get softer.' },
]
const LIMITS = [100, 200, 500, 1024, 2048] // KB

export function CompressDialog() {
  const open = useStore((s) => s.compressOpen)
  return open ? <Panel /> : null
}

function Panel() {
  const close = () => useStore.getState().setCompressOpen(false)
  const [pages] = useState(targets)
  const [stem] = useState(() => baseName(pages))
  const [original, setOriginal] = useState<number | null>(null)
  const [results, setResults] = useState<Partial<Record<Choice, Result>>>({})
  const [choice, setChoice] = useState<Choice>('balanced')
  const [limitKb, setLimitKb] = useState<number | null>(null)
  const [custom, setCustom] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)
  const alive = useRef(true)
  const panel = useRef<HTMLDivElement>(null)

  const run = async (key: Choice, options: JobOptions) => {
    setResults((r) => ({ ...r, [key]: 'working' }))
    try {
      const { files, stats } = await runJob('compress', pages, `${stem}-compressed.pdf`, options)
      if (!alive.current || !stats) return
      setOriginal(stats.original)
      setResults((r) => ({ ...r, [key]: { bytes: files[0].bytes, size: stats.size, met: stats.met } }))
    } catch {
      if (alive.current) setResults((r) => ({ ...r, [key]: 'failed' }))
    }
  }

  useEffect(() => {
    alive.current = true
    ;(async () => {
      for (const id of ['balanced', 'light', 'smallest'] as const) await run(id, { preset: id })
    })()
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => {
      alive.current = false
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fitUnder = (kb: number) => {
    setLimitKb(kb)
    setChoice('target')
    run('target', { target: kb * 1024 })
  }

  const applyCustom = () => {
    const parsed = parseSize(custom)
    if ('error' in parsed) return setCustomError(parsed.error)
    setCustomError(null)
    fitUnder(parsed.kb)
  }

  const picked = results[choice]
  const ready = typeof picked === 'object'
  const allDone = LEVELS.every(({ id }) => typeof results[id] === 'object')
  const alreadyCompact =
    allDone && original !== null && LEVELS.every(({ id }) => (results[id] as { size: number }).size > original * 0.95)

  const save = () => {
    if (!ready) return
    download(picked.bytes, `${stem}-compressed.pdf`, 'application/pdf')
    useStore.getState().notify(`Compressed to ${formatBytes(picked.size)}`)
    close()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgb(16_24_40/0.45)] backdrop-blur-[2px] sm:items-center sm:p-6" onClick={close}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compress-title"
        onClick={(e) => e.stopPropagation()}
        className="toast-in-up max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-desk p-5 shadow-[0_24px_60px_-12px_rgb(16_24_40/0.5)] outline-none sm:rounded-3xl sm:p-7"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="compress-title" className="text-2xl font-semibold tracking-tight">
              Compress
            </h2>
            <p className="mt-1 text-sm text-muted">
              {pages.length} {pages.length === 1 ? 'page' : 'pages'}
              {original !== null ? `, ${formatBytes(original)} before compressing` : ''}
            </p>
          </div>
          <IconButton label="Close" onClick={close} className="-mr-2 -mt-1">
            <X />
          </IconButton>
        </div>

        <div role="radiogroup" aria-label="Compression level" className="mt-5 grid gap-2">
          {LEVELS.map(({ id, title, hint }) => (
            <Option key={id} selected={choice === id} onSelect={() => setChoice(id)} title={title} hint={hint} result={results[id]} original={original} />
          ))}
          {limitKb !== null && (
            <Option
              selected={choice === 'target'}
              onSelect={() => setChoice('target')}
              title={`Under ${formatBytes(limitKb * 1024)}`}
              hint={
                typeof results.target === 'object' && !results.target.met
                  ? 'Can’t get this file that small. This is as small as it goes.'
                  : 'The best quality that fits the limit.'
              }
              result={results.target}
              original={original}
              warn={typeof results.target === 'object' && !results.target.met}
            />
          )}
        </div>

        <div className="mt-6">
          <p className="text-sm font-semibold">Fit under a size limit</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {LIMITS.map((kb) => (
              <button
                key={kb}
                type="button"
                onClick={() => fitUnder(kb)}
                className={`h-9 rounded-full border px-3.5 text-sm font-medium tabular-nums transition-colors active:scale-95 ${
                  limitKb === kb ? 'border-transparent bg-hi text-[#1d2532]' : 'border-line hover:bg-desk-2'
                }`}
              >
                {formatBytes(kb * 1024)}
              </button>
            ))}
            <form
              className={`flex h-9 items-center rounded-full border pl-3.5 pr-1 focus-within:border-ink ${customError ? 'border-fg' : 'border-line'}`}
              onSubmit={(e) => {
                e.preventDefault()
                applyCustom()
              }}
            >
              <input
                value={custom}
                onChange={(e) => {
                  setCustom(e.target.value)
                  setCustomError(null)
                }}
                placeholder="e.g. 300 KB"
                aria-label="Custom size limit, in KB or MB"
                aria-invalid={customError !== null}
                aria-describedby={customError ? 'size-error' : undefined}
                className="w-24 bg-transparent text-sm outline-none placeholder:text-muted"
              />
              <button type="submit" className="h-7 rounded-full px-2.5 text-sm font-semibold text-ink hover:bg-desk-2">
                Fit
              </button>
            </form>
          </div>
          {customError && (
            <p id="size-error" role="alert" className="mt-2 text-sm font-medium">
              {customError}
            </p>
          )}
        </div>

        {alreadyCompact && (
          <p className="mt-5 rounded-2xl bg-desk-2 px-4 py-3 text-sm">
            This PDF is already compact. It’s mostly text or drawings, which compression can’t shrink much.
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-xs leading-snug text-muted">Text stays sharp. Only images are resized, on this device.</p>
          <Button variant="primary" onClick={save} disabled={!ready}>
            <ArrowDownToLine />
            {ready ? `Download ${formatBytes(picked.size)}` : 'Download'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Option(props: {
  selected: boolean
  onSelect: () => void
  title: string
  hint: string
  result: Result | undefined
  original: number | null
  warn?: boolean
}) {
  const { selected, onSelect, title, hint, result, original, warn } = props
  const saved = typeof result === 'object' && original ? Math.round(100 - (result.size / original) * 100) : null
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-center gap-4 rounded-2xl border px-4 py-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
        selected ? 'border-transparent bg-hi text-[#1d2532]' : 'border-line hover:bg-desk-2'
      }`}
    >
      <span
        className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${selected ? 'border-[#1d2532] bg-[#1d2532] text-hi' : 'border-muted'}`}
        aria-hidden="true"
      >
        {selected && <Check className="size-3" strokeWidth={3.5} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className={`block text-sm ${selected ? 'text-[#4a4420]' : warn ? 'text-fg' : 'text-muted'}`}>{hint}</span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        {result === 'working' || result === undefined ? (
          <LoaderCircle className="spin size-5 opacity-60" aria-label="Working out the size" />
        ) : result === 'failed' ? (
          <span className="text-sm">Failed</span>
        ) : (
          <>
            <span className="block font-semibold">{formatBytes(result.size)}</span>
            <span className={`block text-xs ${selected ? 'text-[#4a4420]' : 'text-muted'}`}>{saved && saved > 0 ? `${saved}% smaller` : 'No saving'}</span>
          </>
        )}
      </span>
    </button>
  )
}
