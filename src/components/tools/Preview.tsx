import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle, X, ZoomIn, ZoomOut } from 'lucide-react'
import { renderLarge } from '../../lib/pdf'
import { useStore } from '../../lib/store'

const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3]

/** One page, large. Arrow keys move between pages, + and − zoom, 0 fits it to the screen, Escape closes. */
export default function Preview() {
  const pages = useStore((s) => s.pages)
  const sources = useStore((s) => s.sources)
  const pageId = useStore((s) => s.previewPage)
  const open = useStore((s) => s.openPreview)
  const close = useStore((s) => s.closeTool)
  const at = pages.findIndex((p) => p.id === pageId)
  const page = pages[at]
  const source = page && sources[page.sourceId]

  const [zoom, setZoom] = useState(1)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [natural, setNatural] = useState<[number, number] | null>(null)
  const [frameSize, setFrameSize] = useState<[number, number]>([0, 0])
  const root = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!page) close() // the page was deleted while it was open
  }, [page])

  useEffect(() => {
    if (!page || !source) return
    let alive = true
    let made: string | null = null
    setUrl(null)
    setFailed(false)
    setNatural(null)
    // Sharp enough to zoom in a little: one and a half times the screen, capped to keep memory sensible.
    const longPx = Math.min(3600, Math.round(Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2) * 1.5))
    renderLarge(source, page.index, page.rotation, longPx).then(
      (u) => {
        made = u
        if (alive) setUrl(u)
        else URL.revokeObjectURL(u)
      },
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [page?.id, page?.rotation])

  useLayoutEffect(() => {
    const measure = () => frame.current && setFrameSize([frame.current.clientWidth - 32, frame.current.clientHeight - 32])
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const go = (step: number) => {
    // Read the position now, not from the last render: keys can arrive faster than the screen redraws.
    const st = useStore.getState()
    const next = st.pages[st.pages.findIndex((p) => p.id === st.previewPage) + step]
    if (!next) return
    setZoom(1)
    open(next.id)
  }
  const zoomBy = (step: number) => setZoom((z) => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + step))])

  useLayoutEffect(() => {
    root.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      const keys: Record<string, () => void> = {
        Escape: close,
        ArrowLeft: () => go(-1),
        ArrowRight: () => go(1),
        '+': () => zoomBy(1),
        '=': () => zoomBy(1),
        '-': () => zoomBy(-1),
        '0': () => setZoom(1),
      }
      if (e.key === 'Tab') {
        const items = [...(root.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])]
        const [first, last] = [items[0], items[items.length - 1]]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) e.preventDefault(), last?.focus()
        else if (!e.shiftKey && document.activeElement === last) e.preventDefault(), first?.focus()
        return
      }
      const run = keys[e.key]
      if (!run) return
      e.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [at, pages])

  if (!page || !source) return null
  const fit = natural ? Math.min(frameSize[0] / natural[0], frameSize[1] / natural[1]) : 0
  const width = natural ? Math.max(1, Math.round(natural[0] * fit * zoom)) : undefined
  const label = `Page ${at + 1} of ${pages.length}`

  return (
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-50 flex flex-col bg-[rgb(12_16_24)] text-white outline-none">
      <div className="flex h-16 shrink-0 items-center gap-2 px-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="font-semibold tabular-nums">{label}</div>
          <div className="truncate text-xs text-white/70">
            {source.name}
            {source.pageCount > 1 ? `, page ${page.index + 1}` : ''}
          </div>
        </div>
        <Control label="Zoom out" onClick={() => zoomBy(-1)} disabled={zoom === ZOOMS[0]}>
          <ZoomOut />
        </Control>
        <span className="w-14 text-center text-sm tabular-nums" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <Control label="Zoom in" onClick={() => zoomBy(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]}>
          <ZoomIn />
        </Control>
        <span className="mx-1 h-6 w-px bg-white/25" aria-hidden="true" />
        <Control label="Previous page" onClick={() => go(-1)} disabled={at === 0}>
          <ChevronLeft />
        </Control>
        <Control label="Next page" onClick={() => go(1)} disabled={at === pages.length - 1}>
          <ChevronRight />
        </Control>
        <Control label="Close preview" onClick={close}>
          <X />
        </Control>
      </div>
      <div ref={frame} className="min-h-0 flex-1 overflow-auto p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <div className="grid min-h-full min-w-full place-items-center" style={{ width: width && width > frameSize[0] ? width + 32 : undefined }}>
          {url ? (
            <img
              src={url}
              alt={label}
              draggable={false}
              onLoad={(e) => setNatural([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}
              style={{ width, visibility: natural ? 'visible' : 'hidden' }}
              className="max-w-none rounded-sm bg-white shadow-[0_20px_60px_-10px_rgb(0_0_0/0.6)]"
            />
          ) : (
            <div role="status" className="flex items-center gap-2 text-sm text-white/80">
              {failed ? (
                'This page can’t be shown.'
              ) : (
                <>
                  <LoaderCircle className="spin size-5" aria-hidden="true" />
                  Drawing the page…
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Control({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-10 shrink-0 place-items-center rounded-full outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-35"
    >
      {children}
    </button>
  )
}
