import { ArrowDownToLine, LoaderCircle, Plus, Redo2, RotateCw, Scissors, Shrink, Trash2, Undo2, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { deleteSelected, exportPdf, pickFiles, rotateTargets, splitPages } from '../lib/actions'
import { Button, IconButton, Wordmark } from './ui'
import { PrivacyBadge } from './PrivacyBadge'
import { ToolsMenu } from './ToolsMenu'

export function TopBar() {
  const pages = useStore((s) => s.pages)
  const selected = useStore((s) => s.selected.size)
  const busy = useStore((s) => s.busy)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const deselect = useStore((s) => s.deselect)

  const files = new Set(pages.map((p) => p.sourceId)).size
  const summary = `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}${files > 1 ? ` from ${files} files` : ''}`

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-1.5 border-b border-line bg-desk/85 px-3 backdrop-blur-md sm:gap-4 sm:px-8">
      {/* On phones, while pages are selected, the logo and badge step aside so the actions fit. */}
      <a href="/" className={`rounded-lg focus-visible:outline-2 focus-visible:outline-ink ${selected ? 'max-sm:hidden' : ''}`} aria-label="Cornerfold home">
        <Wordmark compact={pages.length > 0} />
      </a>
      {pages.length > 0 && (
        <span className={selected ? 'max-sm:hidden' : 'contents'}>
          <PrivacyBadge />
        </span>
      )}

      <div className="hidden min-w-0 text-sm text-muted md:block" aria-live="polite">
        {busy ? (
          <span className="inline-flex items-center gap-1.5">
            <LoaderCircle className="spin size-4" aria-hidden="true" />
            {busy}
          </span>
        ) : pages.length ? (
          summary
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
        {pages.length > 0 ? (
          <>
            <IconButton label="Undo" onClick={undo} disabled={!canUndo} className={selected ? 'max-sm:hidden' : ''}>
              <Undo2 />
            </IconButton>
            <IconButton label="Redo" onClick={redo} disabled={!canRedo} className="hidden sm:grid">
              <Redo2 />
            </IconButton>
            <span className="mx-2 h-6 w-px bg-line max-sm:hidden" aria-hidden="true" />

            {selected > 0 ? (
              <>
                {/* On phones just the number shows, as in a phone's own selection bar; "selected" stays for screen readers. */}
                <span className="whitespace-nowrap px-1.5 text-sm font-semibold tabular-nums sm:px-2">
                  {selected}
                  <span className="max-sm:sr-only"> selected</span>
                </span>
                <IconButton label="Rotate selected" onClick={() => rotateTargets(90)}>
                  <RotateCw />
                </IconButton>
                <IconButton label="Delete selected" onClick={deleteSelected}>
                  <Trash2 />
                </IconButton>
                <IconButton label="Clear selection" onClick={deselect}>
                  <X />
                </IconButton>
              </>
            ) : (
              <Button onClick={pickFiles} aria-label="Add files" className="max-sm:px-2.5">
                <Plus />
                <span className="hidden sm:inline">Add files</span>
              </Button>
            )}

            <ToolsMenu />
            <Button onClick={() => useStore.getState().setCompressOpen(true)} disabled={!!busy} aria-label="Compress" className="max-sm:hidden">
              <Shrink />
              <span className="hidden sm:inline">Compress</span>
            </Button>
            <Button onClick={splitPages} disabled={!!busy || pages.length < 2} aria-label="Split into separate PDFs" className="max-sm:hidden">
              <Scissors />
              Split
            </Button>
            <Button variant="primary" onClick={exportPdf} disabled={!!busy} className="ml-1">
              <ArrowDownToLine />
              Export
              {selected ? <span className="max-sm:hidden"> {selected}</span> : null}
              <span className="hidden lg:inline">{selected ? '' : ' PDF'}</span>
            </Button>
          </>
        ) : (
          <nav className="flex items-center gap-1 text-sm font-medium text-muted">
            <a href="/changes.html" className="rounded-full px-3 py-2 hover:text-fg">
              What’s new
            </a>
            <a href="/privacy.html" className="rounded-full px-3 py-2 hover:text-fg">
              Privacy
            </a>
          </nav>
        )}
      </div>
    </header>
  )
}
