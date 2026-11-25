import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, Search } from 'lucide-react'
import type { Hit } from '../../lib/findText'
import { MAX_HITS } from '../../lib/findText'
import type { Mark } from '../../lib/marks'
import { redactionsOf } from '../../lib/marks'
import { pageMatches } from '../../lib/pdf'
import { newId, useStore, type Page } from '../../lib/store'
import { Button, Sheet } from '../ui'

interface Found {
  key: string
  page: Page
  number: number
  hit: Hit
}

/** The part of a box already covered by redactions on the page, as a share of the box. */
const covered = (box: { x: number; y: number; w: number; h: number }, others: { x: number; y: number; w: number; h: number }[]) =>
  others.some((o) => {
    const w = Math.min(box.x + box.w, o.x + o.w) - Math.max(box.x, o.x)
    const h = Math.min(box.y + box.h, o.y + o.h) - Math.max(box.y, o.y)
    return w > 0 && h > 0 && (w * h) / (box.w * box.h) > 0.8
  })

/**
 * Find words in the document and turn what is found into redaction boxes. Every match is listed first, with the
 * words around it, and only the ones left ticked are added. Nothing is applied until the document is exported.
 */
export function FindRedact({ onClose, onAdded }: { onClose: () => void; onAdded: (firstPageId: string) => void }) {
  const pages = useStore((s) => s.pages)
  const sources = useStore((s) => s.sources)
  const addMarks = useStore((s) => s.addMarks)
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null)
  const [found, setFound] = useState<Found[] | null>(null)
  const [unsearchable, setUnsearchable] = useState(0)
  const [failed, setFailed] = useState(0)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const run = useRef(0)
  useEffect(() => () => void (run.current = -1), [])

  const search = async () => {
    const asked = query.trim()
    if (!asked || progress) return
    const mine = ++run.current
    setFound(null)
    setProgress({ done: 0, of: pages.length })
    const out: Found[] = []
    let none = 0
    let bad = 0
    for (let i = 0; i < pages.length; i++) {
      if (run.current !== mine) return
      const page = pages[i]
      try {
        const { hasText, hits } = await pageMatches(sources[page.sourceId], page.index, asked, { matchCase, wholeWord })
        if (!hasText) none++
        for (const [n, hit] of hits.entries()) if (out.length < MAX_HITS) out.push({ key: `${page.id}:${n}`, page, number: i + 1, hit })
      } catch {
        bad++
      }
      setProgress({ done: i + 1, of: pages.length })
      if (out.length >= MAX_HITS) break
    }
    if (run.current !== mine) return
    setFound(out)
    setUnsearchable(none)
    setFailed(bad)
    setTicked(new Set(out.map((f) => f.key)))
    setProgress(null)
  }

  const chosen = useMemo(() => (found ?? []).filter((f) => ticked.has(f.key)), [found, ticked])
  const pagesWithHits = new Set((found ?? []).map((f) => f.page.id)).size
  const capped = (found?.length ?? 0) >= MAX_HITS

  const add = () => {
    const added: Record<string, Mark[]> = {}
    for (const f of chosen) {
      const already = [...redactionsOf(f.page.marks), ...redactionsOf(added[f.page.id])]
      for (const box of f.hit.boxes) {
        if (covered(box, already)) continue
        ;(added[f.page.id] ??= []).push({ id: newId(), kind: 'redact', ...box })
      }
    }
    if (!Object.keys(added).length) return onClose()
    addMarks(added)
    onAdded(chosen.find((f) => added[f.page.id])!.page.id)
  }

  const toggle = (key: string) =>
    setTicked((t) => {
      const next = new Set(t)
      if (!next.delete(key)) next.add(key)
      return next
    })

  return (
    <Sheet
      title="Find and redact"
      intro="Search every page for a word or phrase. Check the matches below, then add boxes over the ones you want covered."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={add} disabled={!found || chosen.length === 0}>
            Add {chosen.length || ''} {chosen.length === 1 ? 'redaction' : 'redactions'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
      >
        <label htmlFor="find-text" className="text-sm font-semibold">
          Words to find
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="find-text"
            data-autofocus
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            autoComplete="off"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-paper px-4 text-base outline-none focus:border-ink"
          />
          <Button type="submit" variant="primary" disabled={!query.trim() || !!progress} className="!h-12">
            <Search />
            Find
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.currentTarget.checked)} className="size-4 accent-[var(--ink)]" />
            Match capitals
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.currentTarget.checked)} className="size-4 accent-[var(--ink)]" />
            Whole words only
          </label>
        </div>
      </form>

      <div role="status" aria-live="polite" className="mt-4 text-sm">
        {progress ? (
          <span className="inline-flex items-center gap-2 text-muted">
            <LoaderCircle className="spin size-4" aria-hidden="true" />
            Searching page {Math.min(progress.done + 1, progress.of)} of {progress.of}…
          </span>
        ) : found ? (
          <span className="font-medium">
            {found.length === 0 ? 'No matches.' : `${capped ? 'The first ' : ''}${found.length} ${found.length === 1 ? 'match' : 'matches'} on ${pagesWithHits} ${pagesWithHits === 1 ? 'page' : 'pages'}.`}
            {capped && ' Search for something more specific to see the rest.'}
          </span>
        ) : null}
      </div>

      {found && found.length > 0 && (
        <>
          <div className="mt-2 flex gap-3 text-sm">
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => setTicked(new Set(found.map((f) => f.key)))}>
              Tick all
            </button>
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => setTicked(new Set())}>
              Untick all
            </button>
          </div>
          <ul className="mt-2 max-h-[32dvh] sm:max-h-[40dvh] divide-y divide-line overflow-y-auto rounded-2xl border border-line bg-paper">
            {found.map((f) => (
              <li key={f.key}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm">
                  <input type="checkbox" checked={ticked.has(f.key)} onChange={() => toggle(f.key)} className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]" />
                  <span className="shrink-0 tabular-nums text-muted">Page {f.number}</span>
                  <span className="min-w-0 break-words">
                    <span className="text-muted">{f.hit.before}</span>
                    <mark className="rounded bg-hi px-0.5 font-semibold text-fg">{f.hit.text}</mark>
                    <span className="text-muted">{f.hit.after}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {found && (unsearchable > 0 || failed > 0) && (
        <p className="mt-3 text-sm font-medium">
          {unsearchable > 0 && `${unsearchable} ${unsearchable === 1 ? 'page has' : 'pages have'} no text to search (scans and photos), so any words on ${unsearchable === 1 ? 'it' : 'them'} need a box drawn by hand. `}
          {failed > 0 && `${failed} ${failed === 1 ? 'page' : 'pages'} could not be read.`}
        </p>
      )}

      <p className="mt-3 text-xs text-muted">
        Boxes are placed from the text on each page and can be a little off, so look over every page afterwards. Only text the page really contains is found: words in a picture are not.
      </p>
    </Sheet>
  )
}
