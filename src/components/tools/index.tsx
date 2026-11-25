// The tool panels. Loaded only when a tool is first opened, so they cost nothing on the first screen.
import { useMemo, useState } from 'react'
import { collectText, exportProtected, exportStamped, saveImages } from '../../lib/exporters'
import { labelsFor, unsupportedCharacters, type NumberFormat, type NumberOptions, type NumberPosition, type WatermarkOptions } from '../../lib/stampText'
import { download } from '../../lib/actions'
import { describePaper, placeImage, type Paper } from '../../lib/paper'
import { chunks, selectIndices, splitBy } from '../../lib/pageTools'
import { everyNth, formatRanges, parseGroups, parseRanges } from '../../lib/ranges'
import { useStore } from '../../lib/store'
import { Button, Sheet } from '../ui'
import { Choices, Field, TextInput } from './parts'
import Preview from './Preview'
import FillSign from './FillSign'

export default function Tools() {
  const tool = useStore((s) => s.tool)
  if (tool === 'select') return <SelectPanel />
  if (tool === 'split') return <SplitPanel />
  if (tool === 'paper') return <PaperPanel />
  if (tool === 'preview') return <Preview />
  if (tool === 'sign') return <FillSign />
  if (tool === 'images') return <ImagesPanel />
  if (tool === 'text') return <TextPanel />
  if (tool === 'numbers') return <NumbersPanel />
  if (tool === 'watermark') return <WatermarkPanel />
  if (tool === 'protect') return <ProtectPanel />
  return null
}

const pagesWord = (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}`
const problemOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

function SelectPanel() {
  const pages = useStore((s) => s.pages)
  const selected = useStore((s) => s.selected)
  const close = useStore((s) => s.closeTool)
  const total = pages.length
  const [text, setText] = useState(() => formatRanges(pages.flatMap((p, i) => (selected.has(p.id) ? [i] : []))))
  const [step, setStep] = useState('3')

  const typed = useMemo(() => {
    if (!text.trim()) return null
    try {
      return { indices: parseRanges(text, total) }
    } catch (e) {
      return { error: problemOf(e) }
    }
  }, [text, total])
  const nth = Math.floor(Number(step))
  const pick = (indices: number[]) => {
    selectIndices(indices)
    close()
  }

  return (
    <Sheet
      title="Select pages"
      intro={`This document has ${pagesWord(total)}.`}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!typed?.indices?.length} onClick={() => typed?.indices && pick(typed.indices)}>
            Select
          </Button>
        </>
      }
    >
      <Field id="select-ranges" label="Page numbers" error={typed?.error} hint={typed?.indices ? `Selects ${typed.indices.length} of ${pagesWord(total)}.` : 'For example 1-3, 7, 10- (a number then a dash means “to the end”).'}>
        <TextInput
          id="select-ranges"
          data-autofocus
          inputMode="text"
          placeholder="1-3, 7, 10-"
          value={text}
          aria-describedby="select-ranges-note"
          aria-invalid={!!typed?.error}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && typed?.indices?.length && pick(typed.indices)}
        />
      </Field>

      <div className="mt-6">
        <div className="text-sm font-semibold">Or pick a pattern</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button className="border border-line" onClick={() => pick(everyNth(total, 2, 1))}>
            Odd pages
          </Button>
          <Button className="border border-line" onClick={() => pick(everyNth(total, 2, 2))}>
            Even pages
          </Button>
          <Button className="border border-line" onClick={() => pick(pages.map((_, i) => i))}>
            All
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="select-step" className="text-sm">
            Every
          </label>
          <TextInput id="select-step" inputMode="numeric" value={step} onInput={(e) => setStep(e.currentTarget.value)} className="!h-10 !w-20 text-center" aria-label="Every how many pages" />
          <span className="text-sm">pages, starting at that page</span>
          <Button className="border border-line" disabled={!(nth >= 2 && nth <= total)} onClick={() => pick(everyNth(total, nth, nth))}>
            Select every {nth >= 2 ? nth : 'N'}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

type SplitKind = 'each' | 'ranges' | 'every' | 'size'

function SplitPanel() {
  const total = useStore((s) => s.pages.length)
  const close = useStore((s) => s.closeTool)
  const [kind, setKind] = useState<SplitKind>('ranges')
  const [ranges, setRanges] = useState('')
  const [every, setEvery] = useState('2')
  const [megabytes, setMegabytes] = useState('5')

  const plan = useMemo((): { groups?: number[][]; maxBytes?: number; note?: string; error?: string } => {
    try {
      if (kind === 'each') return { groups: chunks(total, 1), note: `Makes ${total} PDFs, one for each page.` }
      if (kind === 'ranges') {
        if (!ranges.trim()) return { note: 'Each range you type becomes its own PDF. For example 1-3, 4-10 makes two.' }
        const groups = parseGroups(ranges, total)
        return { groups, note: `Makes ${groups.length} ${groups.length === 1 ? 'PDF' : 'PDFs'}: ${groups.map((g) => pagesWord(g.length)).join(', ')}.` }
      }
      if (kind === 'every') {
        const n = Math.floor(Number(every))
        if (!(n >= 1)) return { error: 'Type a number of pages, 1 or more.' }
        const groups = chunks(total, n)
        return { groups, note: `Makes ${groups.length} ${groups.length === 1 ? 'PDF' : 'PDFs'} of up to ${pagesWord(n)} each.` }
      }
      const mb = Number(megabytes)
      if (!(mb > 0)) return { error: 'Type a size in MB, such as 5 or 0.5.' }
      return { maxBytes: Math.round(mb * 1024 * 1024), note: `Puts as many pages in each PDF as fit under ${megabytes} MB. A page bigger than that on its own gets a PDF to itself.` }
    } catch (e) {
      return { error: problemOf(e) }
    }
  }, [kind, ranges, every, megabytes, total])

  const ready = !!(plan.groups?.length || plan.maxBytes)
  const go = () => {
    if (!ready) return
    close()
    void splitBy(plan.maxBytes ? { maxBytes: plan.maxBytes } : { groups: plan.groups! })
  }

  return (
    <Sheet
      title="Split"
      intro={`Splits the whole document (${pagesWord(total)}) in its current order. You get the PDFs together in one ZIP.`}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!ready} onClick={go}>
            Split
          </Button>
        </>
      }
    >
      <Choices<SplitKind>
        label="How to split"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'ranges', label: 'By ranges' },
          { value: 'every', label: 'Every N pages' },
          { value: 'size', label: 'By size' },
          { value: 'each', label: 'Every page' },
        ]}
      />
      <div className="mt-5">
        {kind === 'ranges' && (
          <Field id="split-ranges" label="Ranges" error={plan.error} hint={plan.note}>
            <TextInput id="split-ranges" data-autofocus placeholder="1-3, 4-10" value={ranges} aria-describedby="split-ranges-note" aria-invalid={!!plan.error} onInput={(e) => setRanges(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
          </Field>
        )}
        {kind === 'every' && (
          <Field id="split-every" label="Pages in each PDF" error={plan.error} hint={plan.note}>
            <TextInput id="split-every" inputMode="numeric" value={every} aria-describedby="split-every-note" aria-invalid={!!plan.error} onInput={(e) => setEvery(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && go()} className="!w-28" />
          </Field>
        )}
        {kind === 'size' && (
          <Field id="split-size" label="Largest size of each PDF, in MB" error={plan.error} hint={plan.note}>
            <TextInput id="split-size" inputMode="decimal" value={megabytes} aria-describedby="split-size-note" aria-invalid={!!plan.error} onInput={(e) => setMegabytes(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && go()} className="!w-28" />
          </Field>
        )}
        {kind === 'each' && <p className="text-sm text-muted">{plan.note}</p>}
      </div>
    </Sheet>
  )
}

/** A small drawing of a page with a photo of the given shape placed on it. */
function PaperDrawing({ paper, photo, label }: { paper: Paper; photo: [number, number]; label: string }) {
  const { page, box } = placeImage(photo[0], photo[1], paper)
  const scale = 112 / Math.max(page[0], page[1])
  const pct = (n: number, of: number) => `${(n / of) * 100}%`
  return (
    <figure className="flex flex-col items-center gap-2">
      <div className="grid h-[120px] w-[120px] place-items-center">
        <div className="relative rounded-[3px] border border-line bg-white shadow-sm" style={{ width: page[0] * scale, height: page[1] * scale }}>
          <div
            className="absolute rounded-[2px] bg-[linear-gradient(135deg,var(--ink),var(--hi))] opacity-80"
            style={{ left: pct(box.x, page[0]), bottom: pct(box.y, page[1]), width: pct(box.width, page[0]), height: pct(box.height, page[1]) }}
          />
        </div>
      </div>
      <figcaption className="text-xs text-muted">{label}</figcaption>
    </figure>
  )
}

function PaperPanel() {
  const current = useStore((s) => s.paper)
  const setPaper = useStore((s) => s.setPaper)
  const notify = useStore((s) => s.notify)
  const close = useStore((s) => s.closeTool)
  const photos = useStore((s) => s.pages.filter((p) => s.sources[p.sourceId]?.kind === 'image').length)
  const [draft, setDraft] = useState<Paper>(current)
  const change = (part: Partial<Paper>) => setDraft((d) => ({ ...d, ...part }))
  const save = () => {
    setPaper(draft)
    notify(`Photos will be placed on pages as ${describePaper(draft)} when you export.`)
    close()
  }

  return (
    <Sheet
      title="Page size for photos"
      intro={
        photos
          ? `Applies to the ${photos === 1 ? 'photo' : `${photos} photos`} in this document when you export, split or compress. PDF pages stay as they are.`
          : 'Applies to photos and screenshots you add, when you export, split or compress. PDF pages stay as they are.'
      }
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Use these settings
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="mb-2 text-sm font-semibold">Paper</div>
          <Choices<Paper['size']> label="Paper" value={draft.size} onChange={(size) => change({ size })} options={[{ value: 'original', label: 'Photo’s own size' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }]} />
        </div>
        {draft.size !== 'original' && (
          <>
            <div>
              <div className="mb-2 text-sm font-semibold">Margin</div>
              <Choices<Paper['margin']> label="Margin" value={draft.margin} onChange={(margin) => change({ margin })} options={[{ value: 'none', label: 'None' }, { value: 'small', label: '1 cm' }, { value: 'wide', label: '2 cm' }]} />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold">Orientation</div>
              <Choices<Paper['orientation']> label="Orientation" value={draft.orientation} onChange={(orientation) => change({ orientation })} options={[{ value: 'auto', label: 'Match each photo' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
            </div>
          </>
        )}
        <div className="flex justify-center gap-6 rounded-2xl bg-desk-2 py-3" aria-hidden="true">
          <PaperDrawing paper={draft} photo={[1600, 1200]} label="A landscape photo" />
          <PaperDrawing paper={draft} photo={[1200, 1600]} label="A portrait photo" />
        </div>
        <p className="text-sm text-muted">The page cards keep showing the photos themselves. The paper is added when the PDF is made.</p>
      </div>
    </Sheet>
  )
}

/** Which pages a tool will use: the selected ones, or all of them. */
function useScope() {
  const total = useStore((s) => s.pages.length)
  const chosen = useStore((s) => s.selected.size)
  return { count: chosen || total, label: chosen ? `the ${pagesWord(chosen)} you selected` : total === 1 ? 'the page' : `all ${total} pages` }
}

function ImagesPanel() {
  const close = useStore((s) => s.closeTool)
  const scope = useScope()
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg')
  const [dpi, setDpi] = useState<'72' | '150' | '300'>('150')
  const go = () => {
    close()
    void saveImages(format, Number(dpi))
  }
  return (
    <Sheet
      title="Save as images"
      intro={`Saves ${scope.label} as ${scope.count === 1 ? 'an image' : 'images, together in one ZIP'}.`}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={go}>
            Save {scope.count === 1 ? 'image' : `${scope.count} images`}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="mb-2 text-sm font-semibold">Format</div>
          <Choices<'jpg' | 'png'> label="Format" value={format} onChange={setFormat} options={[{ value: 'jpg', label: 'JPG, smaller' }, { value: 'png', label: 'PNG, sharpest' }]} />
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold">Detail</div>
          <Choices<'72' | '150' | '300'> label="Detail" value={dpi} onChange={setDpi} options={[{ value: '72', label: 'Screen' }, { value: '150', label: 'Standard' }, { value: '300', label: 'Print' }]} />
          <p className="mt-2 text-sm text-muted">
            {dpi === '72' ? 'Good for sharing on a phone or a website.' : dpi === '150' ? 'Clear on any screen, and fine for most printing.' : 'Sharp enough to print. Files are larger.'} Photos are saved at their own size.
          </p>
        </div>
      </div>
    </Sheet>
  )
}

function TextPanel() {
  const close = useStore((s) => s.closeTool)
  const scope = useScope()
  const [state, setState] = useState<'idle' | 'reading' | Awaited<ReturnType<typeof collectText>>>('idle')
  const [copied, setCopied] = useState(false)
  const read = async () => {
    setState('reading')
    setState(await collectText())
  }
  const result = typeof state === 'object' ? state : null
  return (
    <Sheet
      title="Extract text"
      intro={`Copies the text from ${scope.label}, so you can paste it or save it as a text file.`}
      onClose={close}
      footer={
        result ? (
          <>
            <Button
              onClick={async () => {
                await navigator.clipboard.writeText(result.text)
                setCopied(true)
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button variant="primary" onClick={() => download(new TextEncoder().encode(result.text), result.name, 'text/plain;charset=utf-8')}>
              Save as .txt
            </Button>
          </>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" data-autofocus disabled={state === 'reading'} onClick={read}>
              {state === 'reading' ? 'Reading…' : 'Extract text'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div>
          <p role="status" className="text-sm">
            {result.withText === result.total
              ? `Text found on ${result.total === 1 ? 'the page' : `all ${result.total} pages`}.`
              : `Text found on ${result.withText} of ${pagesWord(result.total)}.`}
            {result.failed.length > 0 && ` Cornerfold couldn’t read ${result.failed.length === 1 ? 'page' : 'pages'} ${result.failed.join(', ')}, so ${result.failed.length === 1 ? 'it is' : 'they are'} marked in the text.`}
            {result.without > 0 && ` ${result.without === 1 ? '1 page has' : `${result.without} pages have`} no text: ${result.without === 1 ? 'it is probably a scan or a picture' : 'they are probably scans or pictures'}, and Cornerfold can’t read text from images yet.`}
          </p>
          <textarea readOnly value={result.text} aria-label="The text" className="mt-3 h-64 w-full resize-y rounded-2xl border border-line bg-paper p-3 font-mono text-xs outline-none focus:border-ink" />
        </div>
      ) : (
        <p className="text-sm text-muted">Only text that is really in the PDF can be read, not text inside photos or scans.</p>
      )}
    </Sheet>
  )
}

const POSITIONS: { value: NumberPosition; label: string }[] = [
  { value: 'bottom-center', label: 'Bottom centre' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'top-center', label: 'Top centre' },
  { value: 'top-right', label: 'Top right' },
  { value: 'top-left', label: 'Top left' },
]

function NumbersPanel() {
  const close = useStore((s) => s.closeTool)
  const scope = useScope()
  const [o, setO] = useState<NumberOptions>({ position: 'bottom-center', format: 'page-n-of-total', start: 1, size: 11, skipFirst: false })
  const [startText, setStartText] = useState('1')
  const set = (part: Partial<NumberOptions>) => setO((x) => ({ ...x, ...part }))
  const start = Number(startText)
  const startError = Number.isInteger(start) && start >= 0 && start <= 99999 ? null : 'Type a whole number, such as 1.'
  const labels = labelsFor(Math.max(1, scope.count), { ...o, start: startError ? 1 : start })
  const example = labels.find((l) => l) ?? '—'
  const top = o.position.startsWith('top')
  const align = o.position.endsWith('left') ? 'justify-start' : o.position.endsWith('right') ? 'justify-end' : 'justify-center'
  const go = () => {
    if (startError) return
    close()
    void exportStamped({ numbers: { ...o, start } })
  }
  return (
    <Sheet
      title="Page numbers"
      intro={`Exports ${scope.label} with page numbers. Your pages here stay as they are.`}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!!startError} onClick={go}>
            Export with page numbers
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex gap-5">
          <div className="min-w-0 flex-1">
            <div className="mb-2 text-sm font-semibold">Position</div>
            <Choices<NumberPosition> label="Position" value={o.position} onChange={(position) => set({ position })} options={POSITIONS} />
          </div>
          <div aria-hidden="true" className={`hidden h-[132px] w-[96px] shrink-0 flex-col rounded-[4px] border border-line bg-white p-2 shadow-sm sm:flex ${top ? 'justify-start' : 'justify-end'}`}>
            <div className={`flex ${align}`}>
              <span className="rounded-sm bg-desk-2 px-1 text-[8px] font-semibold text-[#333]">{example}</span>
            </div>
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold">Style</div>
          <Choices<NumberFormat>
            label="Style"
            value={o.format}
            onChange={(format) => set({ format })}
            options={[
              { value: 'page-n-of-total', label: 'Page 1 of 9' },
              { value: 'n-of-total', label: '1 / 9' },
              { value: 'page-n', label: 'Page 1' },
              { value: 'n', label: '1' },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-start gap-5">
          <Field id="numbers-start" label="First number" error={startError}>
            <TextInput id="numbers-start" inputMode="numeric" value={startText} aria-invalid={!!startError} aria-describedby="numbers-start-note" onInput={(e) => setStartText(e.currentTarget.value)} className="!w-28" />
          </Field>
          <div>
            <div className="mb-1.5 text-sm font-semibold">Size</div>
            <Choices<'9' | '11' | '14'> label="Size" value={String(o.size) as '9' | '11' | '14'} onChange={(v) => set({ size: Number(v) })} options={[{ value: '9', label: 'Small' }, { value: '11', label: 'Medium' }, { value: '14', label: 'Large' }]} />
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={o.skipFirst} onChange={(e) => set({ skipFirst: e.currentTarget.checked })} className="size-5 accent-[var(--ink)]" />
          No number on the first page, such as a cover
        </label>
        <p className="text-sm text-muted" aria-live="polite">
          The first numbered page will show “{example}”.
        </p>
      </div>
    </Sheet>
  )
}

function WatermarkPanel() {
  const close = useStore((s) => s.closeTool)
  const scope = useScope()
  const [text, setText] = useState('')
  const [angle, setAngle] = useState<'45' | '0'>('45')
  const [strength, setStrength] = useState<'0.12' | '0.2' | '0.35'>('0.2')
  const bad = unsupportedCharacters(text)
  const error = bad.length
    ? `Watermarks can use Latin letters, numbers and common symbols for now. Cornerfold can’t draw ${bad.slice(0, 6).join(' ')}${bad.length > 6 ? ' and others' : ''} yet.`
    : text.length > 60
      ? 'Keep it under 60 characters, so it fits across the page.'
      : null
  const options: WatermarkOptions = { text: text.trim(), angle: Number(angle) as 0 | 45, opacity: Number(strength) }
  const go = () => {
    if (error || !options.text) return
    close()
    void exportStamped({ watermark: options })
  }
  return (
    <Sheet
      title="Watermark"
      intro={`Exports ${scope.label} with a see-through watermark across each page. Your pages here stay as they are.`}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!!error || !options.text} onClick={go}>
            Export with watermark
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex gap-5">
          <div className="min-w-0 flex-1">
            <Field id="watermark-text" label="Text" error={error} hint="For example CONFIDENTIAL, DRAFT or COPY.">
              <TextInput id="watermark-text" data-autofocus placeholder="CONFIDENTIAL" value={text} aria-invalid={!!error} aria-describedby="watermark-text-note" onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
            </Field>
          </div>
          <div aria-hidden="true" className="hidden h-[132px] w-[96px] shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-line bg-white shadow-sm sm:flex">
            <span className="whitespace-nowrap text-[11px] font-bold text-[#6b7280]" style={{ transform: `rotate(-${angle}deg)`, opacity: Math.min(1, Number(strength) * 3) }}>
              {options.text || 'CONFIDENTIAL'}
            </span>
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold">Direction</div>
          <Choices<'45' | '0'> label="Direction" value={angle} onChange={setAngle} options={[{ value: '45', label: 'Diagonal' }, { value: '0', label: 'Straight across' }]} />
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold">Strength</div>
          <Choices<'0.12' | '0.2' | '0.35'> label="Strength" value={strength} onChange={setStrength} options={[{ value: '0.12', label: 'Faint' }, { value: '0.2', label: 'Medium' }, { value: '0.35', label: 'Strong' }]} />
        </div>
      </div>
    </Sheet>
  )
}

function ProtectPanel() {
  const close = useStore((s) => s.closeTool)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [shown, setShown] = useState(false)
  const [blockPrinting, setBlockPrinting] = useState(false)
  const [blockCopying, setBlockCopying] = useState(false)
  const [blockEditing, setBlockEditing] = useState(false)
  const [working, setWorking] = useState(false)
  const mismatch = !shown && again !== '' && again !== password
  const ready = password !== '' && (shown || password === again) && !working

  const go = async () => {
    if (!ready) return
    setWorking(true)
    const ok = await exportProtected({ password, blockPrinting, blockCopying, blockEditing })
    setWorking(false)
    if (ok) close()
  }

  return (
    <Sheet
      title="Protect with password"
      intro="The exported file is locked with AES-256 encryption. Nobody can open it without the password, and it never leaves your device."
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!ready} onClick={go}>
            {working ? 'Locking…' : 'Lock and export'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          void go()
        }}
      >
        <Field id="protect-password" label="Password to open the file" hint="Cornerfold cannot recover it. If it is lost, so is the file’s content.">
          <TextInput id="protect-password" data-autofocus type={shown ? 'text' : 'password'} autoComplete="new-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
        </Field>
        {!shown && (
          <Field id="protect-again" label="Type it again" error={mismatch ? 'The two passwords are different.' : null}>
            <TextInput id="protect-again" type="password" autoComplete="new-password" aria-invalid={mismatch} aria-describedby="protect-again-note" value={again} onInput={(e) => setAgain(e.currentTarget.value)} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={shown} onChange={(e) => setShown(e.currentTarget.checked)} className="size-4 accent-[var(--ink)]" />
          Show the password
        </label>
        <fieldset>
          <legend className="text-sm font-semibold">Ask readers not to allow</legend>
          <div className="mt-2 space-y-1.5 text-sm">
            {([
              ['Printing', blockPrinting, setBlockPrinting],
              ['Copying text', blockCopying, setBlockCopying],
              ['Editing', blockEditing, setBlockEditing],
            ] as const).map(([label, on, set]) => (
              <label key={label} className="flex items-center gap-2">
                <input type="checkbox" checked={on} onChange={(e) => set(e.currentTarget.checked)} className="size-4 accent-[var(--ink)]" />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">These are a request: well-behaved PDF readers follow them, but some programs ignore them. Only the password keeps people out.</p>
        </fieldset>
      </form>
    </Sheet>
  )
}
