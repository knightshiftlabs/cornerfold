import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Minus, PenLine, Plus, CalendarDays, EyeOff, Search, Trash2, Type, X } from 'lucide-react'
import { clamp01, type Mark, type MarkImage } from '../../lib/marks'
import { placeImage } from '../../lib/paper'
import { pageFields, pdfPageSize, renderLarge, type FormField } from '../../lib/pdf'
import { unsupportedCharacters } from '../../lib/stampText'
import { newId, useStore, type Page } from '../../lib/store'
import { Button } from '../ui'
import { SignatureMaker } from './SignatureMaker'
import { FindRedact } from './FindRedact'
import { SIGNATURE_NOTE } from '../../lib/signature'
import { REDACT_NOTE } from '../../lib/redactNote'

/** A mark before it has an id and a place. (Omit over each kind separately, so each keeps its own fields.) */
type NewMark = Mark extends infer M ? (M extends Mark ? Omit<M, 'id' | 'x' | 'y'> & { x?: number; y?: number } : never) : never

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const label = (m: Mark) => (m.kind === 'text' ? `Text: ${m.text || 'empty'}` : m.kind === 'image' ? 'Signature' : m.kind === 'redact' ? 'Redaction' : m.kind === 'tick' ? 'Tick' : 'Cross')

/** The page as it will be exported, before any turn added in Cornerfold: its picture and its size in points. */
function usePageView(page: Page | undefined) {
  const sources = useStore((s) => s.sources)
  const paper = useStore((s) => s.paper)
  const [view, setView] = useState<{ url: string; size: [number, number]; photo?: { x: number; y: number; w: number; h: number } } | null>(null)
  const [fields, setFields] = useState<FormField[]>([])
  useEffect(() => {
    if (!page) return
    const source = sources[page.sourceId]
    let alive = true
    let url: string | null = null
    setView(null)
    setFields([])
    ;(async () => {
      if (source.kind === 'image') {
        // A photo is shown on the paper chosen for photos, exactly where the export puts it.
        url = URL.createObjectURL(new Blob([source.bytes], { type: source.mime }))
        const { page: size, box } = placeImage((source.width ?? 1) * 0.75, (source.height ?? 1) * 0.75, paper)
        if (alive) setView({ url, size, photo: { x: box.x / size[0], y: 1 - (box.y + box.height) / size[1], w: box.width / size[0], h: box.height / size[1] } })
        return
      }
      const size = await pdfPageSize(source, page.index)
      url = await renderLarge(source, page.index, 0, Math.min(3000, Math.round(Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio || 1, 2) * 1.3)))
      const found = await pageFields(source, page.index)
      if (alive) {
        setView({ url, size })
        setFields(found)
      } else URL.revokeObjectURL(url)
    })().catch(() => alive && setView({ url: '', size: [595, 842] }))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [page?.id, page?.sourceId, page?.index, paper])
  return { view, fields }
}

export default function FillSign() {
  const pages = useStore((s) => s.pages)
  const startId = useStore((s) => s.previewPage)
  const close = useStore((s) => s.closeTool)
  const setMarks = useStore((s) => s.setMarks)
  const lockAnswers = useStore((s) => s.lockAnswers)
  const setLockAnswers = useStore((s) => s.setLockAnswers)
  const markImages = useStore((s) => s.markImages)
  const [pageId, setPageId] = useState(startId ?? pages[0]?.id)
  const at = Math.max(0, pages.findIndex((p) => p.id === pageId))
  const page = pages[at]
  const { view, fields } = usePageView(page)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [making, setMaking] = useState(false)
  const [finding, setFinding] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /** A tool waiting for a click on the page to say where its mark goes. */
  const [armed, setArmed] = useState<NewMark | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<[number, number]>([0, 0]) // the page's size on screen, in pixels

  // Fit the page into the space available.
  useLayoutEffect(() => {
    const fit = () => {
      if (!frame.current || !view) return
      const [fw, fh] = [frame.current.clientWidth - 24, frame.current.clientHeight - 24]
      const scale = Math.min(fw / view.size[0], fh / view.size[1])
      setBox([Math.max(1, view.size[0] * scale), Math.max(1, view.size[1] * scale)])
    }
    fit()
    addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [view])

  useEffect(() => {
    if (!page) close()
  }, [page])

  const marks = page?.marks ?? []
  const pt = view ? box[1] / view.size[1] : 1 // screen pixels per point
  const save = (next: Mark[]) => page && setMarks(page.id, next)
  const update = (id: string, change: Partial<Mark>) => save(marks.map((m) => (m.id === id ? ({ ...m, ...change } as Mark) : m)))
  const remove = (id: string) => {
    save(marks.filter((m) => m.id !== id))
    setSelected(null)
  }

  /** Adds a mark and selects it. New marks step down the page so they don't land on top of each other. */
  const add = (mark: NewMark) => {
    const id = newId()
    const step = (marks.length % 8) * 0.04
    const next = { x: 0.1, y: 0.1 + step, ...mark, id } as Mark
    save([...marks, next])
    setSelected(id)
    if (next.kind === 'text' && !next.text) setEditing(id)
  }
  /**
   * A toolbar button: clicked with a pointer, it waits for a click on the page; pressed with the keyboard
   * (which browsers report as a click with no pointer detail), it places the mark at once, to move with arrows.
   */
  const offer = (mark: NewMark) => (e: { detail: number }) => {
    if (e.detail === 0) return add(mark)
    setSelected(null)
    setArmed(armed && armed.kind === mark.kind && (armed.kind !== 'text' || (armed as { text: string }).text === (mark as { text?: string }).text) ? null : mark)
  }
  /** Places the waiting mark where the page was clicked: text by its top left, a tick or cross by its middle. */
  const place = (e: ReactPointerEvent) => {
    if (!armed || !stage.current) return
    e.stopPropagation()
    const r = stage.current.getBoundingClientRect()
    let x = (e.clientX - r.left) / r.width
    let y = (e.clientY - r.top) / r.height
    if (armed.kind === 'tick' || armed.kind === 'cross') {
      x -= (armed.size * pt) / 2 / r.width
      y -= (armed.size * pt) / 2 / r.height
    } else if (armed.kind === 'text') y -= (armed.size * pt * 0.6) / r.height
    else if (armed.kind === 'redact') {
      x = Math.min(1 - armed.w, Math.max(0, x - armed.w / 2))
      y = Math.min(1 - armed.h, Math.max(0, y - armed.h / 2))
    }
    add({ ...armed, x: clamp01(x), y: clamp01(y) } as NewMark)
    setArmed(null)
  }

  const addSignature = (img: MarkImage) => {
    if (!view) return
    const w = 0.3
    const h = w * (img.height / img.width) * (view.size[0] / view.size[1])
    add({ kind: 'image', imageId: img.id, w, h, x: 0.55, y: Math.min(0.85, 0.75) })
  }

  const go = (step: number) => {
    const next = pages[at + step]
    if (!next) return
    setSelected(null)
    setEditing(null)
    setPageId(next.id)
  }

  // Moving and resizing with a pointer: the change is saved once, when the pointer lets go.
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; x: number; y: number; start: Mark } | null>(null)
  const [draft, setDraft] = useState<Mark | null>(null)
  const startDrag = (e: ReactPointerEvent, m: Mark, mode: 'move' | 'resize') => {
    if (editing === m.id) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { id: m.id, mode, x: e.clientX, y: e.clientY, start: m }
    setSelected(m.id)
  }
  const moveDrag = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d || !view) return
    const dx = (e.clientX - d.x) / box[0]
    const dy = (e.clientY - d.y) / box[1]
    const m = d.start
    if (d.mode === 'move') setDraft({ ...m, x: m.kind === 'redact' ? Math.min(1 - m.w, Math.max(0, m.x + dx)) : clamp01(m.x + dx), y: m.kind === 'redact' ? Math.min(1 - m.h, Math.max(0, m.y + dy)) : clamp01(m.y + dy) } as Mark)
    else if (m.kind === 'redact') setDraft({ ...m, w: Math.max(0.01, Math.min(1 - m.x, m.w + dx)), h: Math.max(0.01, Math.min(1 - m.y, m.h + dy)) })
    else if (m.kind === 'image') {
      const w = Math.max(0.04, Math.min(1 - m.x, m.w + dx))
      setDraft({ ...m, w, h: m.h * (w / m.w) })
    } else if (m.kind === 'tick' || m.kind === 'cross') setDraft({ ...m, size: Math.max(8, Math.min(120, m.size + (dx * box[0]) / pt)) })
  }
  const endDrag = () => {
    if (drag.current && draft) update(draft.id, draft)
    drag.current = null
    setDraft(null)
  }

  const nudge = (e: KeyboardEvent, m: Mark) => {
    if (editing === m.id) return
    const step = e.shiftKey ? 0.05 : 0.01
    const keys: Record<string, () => void> = {
      ArrowLeft: () => update(m.id, { x: clamp01(m.x - step) }),
      ArrowRight: () => update(m.id, { x: clamp01(m.x + step) }),
      ArrowUp: () => update(m.id, { y: clamp01(m.y - step) }),
      ArrowDown: () => update(m.id, { y: clamp01(m.y + step) }),
      Delete: () => remove(m.id),
      Backspace: () => remove(m.id),
      '+': () => resize(m, 1),
      '=': () => resize(m, 1),
      '-': () => resize(m, -1),
      Enter: () => m.kind === 'text' && setEditing(m.id),
    }
    const run = keys[e.key]
    if (!run) return
    e.preventDefault()
    e.stopPropagation()
    run()
  }
  const resize = (m: Mark, dir: 1 | -1) => {
    if (m.kind === 'image') {
      const w = Math.max(0.04, Math.min(1, m.w * (dir > 0 ? 1.1 : 1 / 1.1)))
      update(m.id, { w, h: m.h * (w / m.w) })
    } else if (m.kind === 'redact') {
      const k = dir > 0 ? 1.1 : 1 / 1.1
      update(m.id, { w: Math.max(0.01, Math.min(1 - m.x, m.w * k)), h: Math.max(0.01, Math.min(1 - m.y, m.h * k)) })
    } else update(m.id, { size: Math.max(6, Math.min(120, Math.round(m.size * (dir > 0 ? 1.15 : 1 / 1.15)))) })
  }

  // The editor's own keys: Escape lets go of a mark, then closes; arrows outside a mark change page. A layout effect, so
  // the handler is in place the moment the editor is drawn, and always knows the current mark rather than the last one.
  useLayoutEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (making || finding) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (armed) setArmed(null)
        else if (editing) setEditing(null)
        else if (selected) setSelected(null)
        else close()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [editing, selected, making, finding, armed])

  const shown = useMemo(() => marks.map((m) => (draft && draft.id === m.id ? draft : m)), [marks, draft])
  const current = shown.find((m) => m.id === selected)
  if (!page) return null

  return (
    <div role="dialog" aria-modal="true" aria-label="Fill and sign" className="fixed inset-0 z-50 flex flex-col bg-desk-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-desk px-3 py-2 sm:px-6">
        <div className="mr-auto min-w-0">
          <div className="font-semibold">Fill and sign</div>
          <div className="text-xs text-muted tabular-nums">
            Page {at + 1} of {pages.length}
          </div>
        </div>
        <Button aria-label="Previous page" onClick={() => go(-1)} disabled={at === 0} className="!px-2.5">
          <ChevronLeft />
        </Button>
        <Button aria-label="Next page" onClick={() => go(1)} disabled={at === pages.length - 1} className="!px-2.5">
          <ChevronRight />
        </Button>
        <Button variant="primary" onClick={close}>
          <Check />
          Done
        </Button>
      </div>

      <div role="toolbar" aria-label="Add to the page" className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-desk px-3 py-2 sm:px-6">
        <Button className="border border-line" aria-pressed={armed?.kind === 'text' && !(armed as { text: string }).text} onClick={offer({ kind: 'text', text: '', size: 12 })}>
          <Type />
          Text
        </Button>
        <Button className="border border-line" onClick={() => setMaking(true)}>
          <PenLine />
          Signature
        </Button>
        {Object.values(markImages).slice(-2).map((img, i) => (
          <Button key={img.id} className="border border-line" onClick={() => addSignature(img)} aria-label={`Add signature ${i + 1} again`}>
            <img src={URL.createObjectURL(new Blob([img.png], { type: 'image/png' }))} alt="" className="h-6 max-w-16 object-contain" onLoad={(e) => URL.revokeObjectURL(e.currentTarget.src)} />
          </Button>
        ))}
        <Button className="border border-line" aria-label="Tick" aria-pressed={armed?.kind === 'tick'} onClick={offer({ kind: 'tick', size: 16 })}>
          <Check />
        </Button>
        <Button className="border border-line" aria-label="Cross" aria-pressed={armed?.kind === 'cross'} onClick={offer({ kind: 'cross', size: 16 })}>
          <X />
        </Button>
        <Button className="border border-line" aria-pressed={armed?.kind === 'text' && !!(armed as { text: string }).text} onClick={offer({ kind: 'text', text: today(), size: 12 })}>
          <CalendarDays />
          Date
        </Button>
        <Button className="border border-line" aria-pressed={armed?.kind === 'redact'} onClick={offer({ kind: 'redact', w: 0.3, h: 0.04 })}>
          <EyeOff />
          Redact
        </Button>
        <Button className="border border-line" onClick={() => setFinding(true)}>
          <Search />
          Find and redact
        </Button>
        {current && (
          <span className="ml-auto flex items-center gap-1" aria-label="Selected item">
            <Button aria-label="Smaller" className="!px-2.5" onClick={() => resize(current, -1)}>
              <Minus />
            </Button>
            <Button aria-label="Larger" className="!px-2.5" onClick={() => resize(current, 1)}>
              <Plus />
            </Button>
            <Button aria-label="Remove" className="!px-2.5" onClick={() => remove(current.id)}>
              <Trash2 />
            </Button>
          </span>
        )}
      </div>

      <div ref={frame} className="relative min-h-0 flex-1 overflow-auto" onPointerDown={() => editing === null && setSelected(null)}>
        <div className="grid min-h-full place-items-center p-3">
          {!view ? (
            <div role="status" className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle className="spin size-5" aria-hidden="true" />
              Drawing the page…
            </div>
          ) : (
            <div ref={stage} className={`relative bg-white shadow-[0_12px_40px_-12px_rgb(16_24_40/0.45)] ${armed ? 'cursor-crosshair' : ''}`} style={{ width: box[0], height: box[1] }} onPointerDown={place} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
              {view.photo ? (
                <img src={view.url} alt={`Page ${at + 1}`} draggable={false} className="absolute" style={{ left: `${view.photo.x * 100}%`, top: `${view.photo.y * 100}%`, width: `${view.photo.w * 100}%`, height: `${view.photo.h * 100}%` }} />
              ) : (
                view.url && <img src={view.url} alt={`Page ${at + 1}`} draggable={false} className="absolute inset-0 size-full" />
              )}
              {armed && <div className="absolute inset-0 z-20" aria-hidden="true" />}
              {fields.map((f) => (
                <FieldInput key={`${f.name}:${f.option ?? ''}:${f.x}`} field={f} sourceId={page.sourceId} heightPx={f.h * box[1]} onProblem={setProblem} />
              ))}
              {shown.map((m) => (
                <MarkView
                  key={m.id}
                  mark={m}
                  pt={pt}
                  box={box}
                  selected={m.id === selected}
                  editing={m.id === editing}
                  image={m.kind === 'image' ? markImages[m.imageId] : undefined}
                  onPointerDown={(e, mode) => startDrag(e, m, mode)}
                  onKeyDown={(e) => nudge(e, m)}
                  onFocus={() => setSelected(m.id)}
                  onEdit={() => setEditing(m.id)}
                  onText={(text) => {
                    const bad = unsupportedCharacters(text.replace(/\n/g, ''))
                    if (bad.length) return setProblem(`Cornerfold can’t write ${bad.slice(0, 6).join(' ')} on pages yet. Text can use Latin letters, numbers and common symbols for now.`), false
                    setProblem(null)
                    return true
                  }}
                  onDone={(text) => {
                    setEditing(null)
                    if (!text.trim()) remove(m.id)
                    else update(m.id, { text })
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-desk px-3 py-2 text-xs text-muted sm:px-6">
        {armed ? (
          <p role="status" className="font-medium text-fg">
            Click on the page where it should go. Press Escape to cancel.
          </p>
        ) : problem ? (
          <p role="alert" className="flex items-start gap-2 font-medium text-fg">
            <span className="mt-1 size-2.5 shrink-0 rounded-full bg-hi" aria-hidden="true" />
            {problem}
          </p>
        ) : (
          <p>
            Drag to move, or use the arrow keys. Changes are added to the pages here, and appear in everything you export.{' '}
            {marks.some((m) => m.kind === 'image') && <span className="block">{SIGNATURE_NOTE}</span>}
            {marks.some((m) => m.kind === 'redact') && <span className="block font-medium text-fg">{REDACT_NOTE}</span>}
            {fields.length > 0 && (
              <label className="ml-1 inline-flex items-center gap-1.5 font-medium text-fg">
                <input type="checkbox" checked={lockAnswers} onChange={(e) => setLockAnswers(e.currentTarget.checked)} className="size-4 accent-[var(--ink)]" />
                Lock the answers when exporting, so they can’t be changed
              </label>
            )}
          </p>
        )}
      </div>

      {finding && (
        <FindRedact
          onClose={() => setFinding(false)}
          onAdded={(firstPageId) => {
            setFinding(false)
            setPageId(firstPageId)
            setSelected(null)
          }}
        />
      )}
      {making && (
        <SignatureMaker
          onClose={() => setMaking(false)}
          onMade={(img) => {
            useStore.getState().addMarkImage(img)
            setMaking(false)
            addSignature(img)
          }}
        />
      )}
    </div>
  )
}

function FieldInput({ field: f, sourceId, heightPx, onProblem }: { field: FormField; sourceId: string; heightPx: number; onProblem: (p: string | null) => void }) {
  const stored = useStore((s) => s.fieldValues[sourceId]?.[f.name])
  const setField = useStore((s) => s.setField)
  const value = stored ?? f.value
  const style = { left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }
  const base = 'absolute rounded-[2px] bg-[rgb(219_234_254/0.75)] outline-none focus:ring-2 focus:ring-ink disabled:opacity-60'
  const font = Math.max(9, Math.min(16, heightPx * 0.62))
  if (f.kind === 'checkbox')
    return <input type="checkbox" aria-label={f.label} disabled={f.readOnly} checked={value === true} onChange={(e) => setField(sourceId, f.name, e.currentTarget.checked)} className={`${base} m-0 accent-[var(--ink)]`} style={style} />
  if (f.kind === 'radio')
    return <input type="radio" name={`${sourceId}:${f.name}`} aria-label={f.label} disabled={f.readOnly} checked={value === f.option} onChange={() => setField(sourceId, f.name, f.option!)} className={`${base} m-0 accent-[var(--ink)]`} style={style} />
  if (f.kind === 'choice')
    return (
      <select aria-label={f.label} disabled={f.readOnly} value={String(value)} onChange={(e) => setField(sourceId, f.name, e.currentTarget.value)} className={base} style={{ ...style, fontSize: font }}>
        <option value="">—</option>
        {f.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  const Tag = f.multiline ? 'textarea' : 'input'
  return (
    <Tag
      aria-label={f.label}
      disabled={f.readOnly}
      value={String(value)}
      onChange={(e: { currentTarget: { value: string } }) => {
        const text = e.currentTarget.value
        const bad = unsupportedCharacters(text.replace(/\n/g, ''))
        if (bad.length) return onProblem(`Cornerfold can’t write ${bad.slice(0, 6).join(' ')} in forms yet. Answers can use Latin letters, numbers and common symbols for now.`)
        onProblem(null)
        setField(sourceId, f.name, text)
      }}
      className={`${base} resize-none px-1`}
      style={{ ...style, fontSize: font }}
    />
  )
}

function MarkView(props: {
  mark: Mark
  pt: number
  box: [number, number]
  selected: boolean
  editing: boolean
  image?: MarkImage
  onPointerDown: (e: ReactPointerEvent, mode: 'move' | 'resize') => void
  onKeyDown: (e: KeyboardEvent) => void
  onFocus: () => void
  onEdit: () => void
  onText: (text: string) => boolean
  onDone: (text: string) => void
}) {
  const { mark: m, pt, selected, editing } = props
  const [text, setText] = useState(m.kind === 'text' ? m.text : '')
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing) area.current?.focus()
  }, [editing])
  const url = useMemo(() => (props.image ? URL.createObjectURL(new Blob([props.image.png], { type: 'image/png' })) : ''), [props.image])
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])

  const ring = selected ? 'outline outline-2 outline-offset-2 outline-ink' : 'hover:outline hover:outline-1 hover:outline-dashed hover:outline-ink/60'
  const pos = { left: `${m.x * 100}%`, top: `${m.y * 100}%` }
  const common = {
    role: 'button',
    tabIndex: 0,
    'aria-label': `${label(m)}. Arrow keys move it, plus and minus resize it, Delete removes it.`,
    'aria-pressed': selected,
    onPointerDown: (e: ReactPointerEvent) => props.onPointerDown(e, 'move'),
    onKeyDown: props.onKeyDown,
    onFocus: props.onFocus,
  } as const

  if (m.kind === 'text') {
    const size = m.size * pt
    if (editing)
      return (
        <textarea
          ref={area}
          aria-label="Text to add"
          value={text}
          rows={Math.max(1, text.split('\n').length)}
          onChange={(e) => props.onText(e.currentTarget.value) && setText(e.currentTarget.value)}
          onBlur={() => props.onDone(text)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault()
              e.stopPropagation()
              props.onDone(text)
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Type here"
          className="absolute z-10 min-w-24 resize-none overflow-hidden rounded-[2px] border border-ink bg-white/90 p-0 font-[Helvetica,Arial,sans-serif] leading-[1.25] text-[#0d1a40] outline-none"
          style={{ ...pos, fontSize: size, width: `${Math.max(8, Math.min(90, Math.max(...text.split('\n').map((l) => l.length), 10) * 0.6 * size + 8))}px` }}
        />
      )
    return (
      <div {...common} onDoubleClick={props.onEdit} className={`absolute cursor-move select-none whitespace-pre font-[Helvetica,Arial,sans-serif] leading-[1.25] text-[#0d1a40] ${ring}`} style={{ ...pos, fontSize: size }}>
        {m.text}
      </div>
    )
  }
  if (m.kind === 'image')
    return (
      <div {...common} className={`absolute cursor-move ${ring}`} style={{ ...pos, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}>
        {url && <img src={url} alt="" draggable={false} className="pointer-events-none size-full" />}
        {selected && <span aria-hidden="true" onPointerDown={(e) => props.onPointerDown(e, 'resize')} className="absolute -bottom-2 -right-2 size-4 cursor-nwse-resize rounded-full border-2 border-white bg-ink" />}
      </div>
    )
  if (m.kind === 'redact')
    return (
      <div {...common} className={`absolute cursor-move bg-black/85 ${ring}`} style={{ ...pos, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}>
        {selected && <span aria-hidden="true" onPointerDown={(e) => props.onPointerDown(e, 'resize')} className="absolute -bottom-2 -right-2 size-4 cursor-nwse-resize rounded-full border-2 border-white bg-ink" />}
      </div>
    )
  const s = m.size * pt
  return (
    <div {...common} className={`absolute cursor-move ${ring}`} style={{ ...pos, width: s, height: s }}>
      <svg viewBox="0 0 1 1" className="pointer-events-none size-full" aria-hidden="true">
        {m.kind === 'tick' ? (
          <polyline points="0.1,0.55 0.4,0.85 0.92,0.12" fill="none" stroke="#0d1a40" strokeWidth="0.12" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M0.15,0.15 L0.85,0.85 M0.85,0.15 L0.15,0.85" stroke="#0d1a40" strokeWidth="0.12" strokeLinecap="round" />
        )}
      </svg>
      {selected && <span aria-hidden="true" onPointerDown={(e) => props.onPointerDown(e, 'resize')} className="absolute -bottom-2 -right-2 size-4 cursor-nwse-resize rounded-full border-2 border-white bg-ink" />}
    </div>
  )
}
