// The quick page tools in the Tools menu: selecting by number, duplicating, reversing, blank pages, splitting.
import { baseName, deletePages, download, message } from './actions'
import { isBlank } from './blank'
import { runJob, type JobOptions } from './engine'
import { getThumb, openPdf } from './pdf'
import { newId, useStore } from './store'

const count = (n: number, noun = 'page') => `${n} ${n === 1 ? noun : `${noun}s`}`

/** Selects the pages at these positions (counted from 0), replacing the current selection. */
export function selectIndices(indices: number[]) {
  const st = useStore.getState()
  const ids = indices.flatMap((i) => (st.pages[i] ? [st.pages[i].id] : []))
  st.selectOnly(ids)
  st.notify(ids.length ? `${count(ids.length)} selected` : 'No pages selected')
}

export function duplicateSelected() {
  const st = useStore.getState()
  if (!st.selected.size) return st.notify('Select the pages to duplicate first.', { tone: 'error' })
  const n = st.selected.size
  st.duplicate(st.selected)
  st.notify(`Duplicated ${count(n)}`)
}

export function reverseOrder() {
  const st = useStore.getState()
  const n = st.selected.size
  st.reverse(st.selected)
  st.notify(n >= 2 ? `Reversed the ${n} selected pages` : 'Reversed the page order')
}

/** Adds an empty page after the last selected page, or at the end, the same size as its neighbour. */
export async function insertBlankPage() {
  const st = useStore.getState()
  if (st.busy) return
  const chosen = st.pages.filter((p) => st.selected.has(p.id))
  const neighbour = chosen[chosen.length - 1] ?? st.pages[st.pages.length - 1]
  st.setBusy('Adding a blank page')
  try {
    const bytes = (await runJob('blank', neighbour ? [neighbour] : [], 'Blank page')).files[0].bytes
    const id = newId()
    await openPdf(id, bytes)
    useStore.getState().insertAfter(chosen.length ? neighbour.id : null, [{ id, name: 'Blank page', kind: 'pdf', bytes, pageCount: 1 }], [{ id: newId(), sourceId: id, index: 0, rotation: 0 }])
    st.notify(chosen.length ? 'Blank page added after the selection' : 'Blank page added at the end')
  } catch (e) {
    st.notify(`Couldn’t add a blank page: ${message(e)}`, { tone: 'error' })
  } finally {
    st.setBusy(null)
  }
}

/** A small picture of the page, as pixels. */
async function pixelsOf(url: string) {
  const img = new Image()
  img.src = url
  await img.decode()
  const scale = Math.min(1, 240 / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  canvas.width = canvas.height = 0
  return { data, w, h }
}

/** Finds the empty pages and selects them. Nothing is deleted until the person says so. */
export async function selectBlankPages() {
  const st = useStore.getState()
  if (st.busy || !st.pages.length) return
  st.setBusy(`Checking ${count(st.pages.length)}`)
  try {
    const found = await Promise.all(
      st.pages.map(async (p) => {
        const source = st.sources[p.sourceId]
        if (!source) return null
        try {
          const { data, w, h } = await pixelsOf(await getThumb(source, p.index))
          return isBlank(data, w, h) ? p.id : null
        } catch {
          return null // a page that can't be drawn is left alone
        }
      }),
    )
    const blank = found.filter((id): id is string => !!id)
    const now = useStore.getState()
    if (!blank.length) return now.notify('No blank pages found.')
    now.selectOnly(blank)
    now.notify(`${count(blank.length, 'blank page')} found and selected.`, { action: { label: blank.length === 1 ? 'Delete it' : 'Delete them', run: () => deletePages(new Set(blank)) } })
  } finally {
    useStore.getState().setBusy(null)
  }
}

export type SplitMode = { groups: number[][] } | { every: number } | { maxBytes: number }

/** Groups of `size` pages each, the last one shorter if the pages don't divide evenly. */
export function chunks(total: number, size: number): number[][] {
  const step = Math.max(1, Math.floor(size))
  return Array.from({ length: Math.ceil(total / step) }, (_, g) => Array.from({ length: Math.min(step, total - g * step) }, (_, i) => g * step + i))
}

/** Splits the whole document, in its current order, into several PDFs delivered as one ZIP. */
export async function splitBy(mode: SplitMode) {
  const st = useStore.getState()
  const list = st.pages
  if (st.busy || !list.length) return
  const options: JobOptions = 'groups' in mode ? { groups: mode.groups } : 'every' in mode ? { groups: chunks(list.length, mode.every) } : { maxBytes: mode.maxBytes }
  const base = baseName(list)
  st.setBusy('Splitting')
  try {
    if (options.groups?.length === 1) {
      // One part is just a PDF; a ZIP holding a single file would only be in the way.
      const [file] = (await runJob('merge', options.groups[0].map((i) => list[i]), `${base}-part.pdf`)).files
      download(file.bytes, file.name, 'application/pdf')
      return st.notify(`Saved ${count(options.groups[0].length)} as ${file.name}`)
    }
    const { files, info } = await runJob('split', list, base, options)
    download(files[0].bytes, files[0].name, 'application/zip')
    const oversize = info?.oversize ? ` ${count(info.oversize)} ${info.oversize === 1 ? 'is' : 'are'} larger than the limit on ${info.oversize === 1 ? 'its' : 'their'} own.` : ''
    st.notify(`Split into ${count(info?.parts ?? 0, 'PDF')}.${oversize}`)
  } catch (e) {
    st.notify(`Split failed: ${message(e)}`, { tone: 'error' })
  } finally {
    st.setBusy(null)
  }
}
