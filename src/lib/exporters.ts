// Saving pages as images or text, and exporting with page numbers or a watermark. Loaded with the tool panels.
import { zipSync } from 'fflate'
import { baseName, download, message, targets } from './actions'
import { runJob } from './engine'
import { pageText, renderPageImage } from './pdf'
import { useStore } from './store'
import { combineText } from './text'
import type { Stamps } from './stampText'

const count = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`
const pad = (n: number, total: number) => String(n).padStart(Math.max(2, String(total).length), '0')

/** Saves each page (the selection, or all) as an image: one image as it is, several in a ZIP. */
export async function saveImages(format: 'jpg' | 'png', dpi: number) {
  const st = useStore.getState()
  const list = targets()
  if (st.busy || !list.length) return
  const base = baseName(list)
  const type = format === 'jpg' ? 'image/jpeg' : 'image/png'
  const files: Record<string, Uint8Array> = {}
  try {
    for (let i = 0; i < list.length; i++) {
      st.setBusy(`Saving page ${i + 1} of ${list.length}`)
      const p = list[i]
      files[`${base}-page-${pad(i + 1, list.length)}.${format}`] = await renderPageImage(st.sources[p.sourceId], p.index, p.rotation, dpi, type)
    }
    const names = Object.keys(files)
    if (names.length === 1) {
      download(files[names[0]], names[0], type)
      return st.notify(`Saved ${names[0]}`)
    }
    const zipName = `${base}-images.zip`
    download(zipSync(files, { level: 0 }), zipName, 'application/zip') // images are already compressed
    st.notify(`Saved ${count(names.length, 'image')} as ${zipName}`)
  } catch (e) {
    st.notify(`Couldn’t save the images: ${message(e)}`, { tone: 'error' })
  } finally {
    useStore.getState().setBusy(null)
  }
}

/** Reads the text of each page (the selection, or all), in order. */
export async function collectText() {
  const st = useStore.getState()
  const list = targets()
  const parts = []
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    parts.push({ page: i + 1, text: await pageText(st.sources[p.sourceId], p.index).catch(() => '') })
  }
  return { ...combineText(parts), total: list.length, name: `${baseName(list)}.txt` }
}

/** Exports (the selection, or all) with page numbers or a watermark drawn on. The document itself is not changed. */
export async function exportStamped(stamps: Stamps) {
  const st = useStore.getState()
  const list = targets()
  if (st.busy || !list.length) return
  const name = `${baseName(list)}-${stamps.watermark ? 'watermarked' : 'numbered'}.pdf`
  st.setBusy('Exporting')
  try {
    const [file] = (await runJob('stamp', list, name, { stamps })).files
    download(file.bytes, file.name, 'application/pdf')
    st.notify(`Exported ${file.name}`)
  } catch (e) {
    st.notify(`Export failed: ${message(e)}`, { tone: 'error' })
  } finally {
    useStore.getState().setBusy(null)
  }
}
