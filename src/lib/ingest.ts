import { useStore, type Page, type Source } from './store'
import { openPdf } from './pdf'
import { stage } from './motion'

const uid = () => crypto.randomUUID()
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const isImage = (f: File) => f.type.startsWith('image/')
const stem = (name: string) => name.replace(/\.[^.]+$/, '') || 'file'

class LockedError extends Error {}

export async function ingestFiles(files: File[]) {
  const st = useStore.getState()
  const usable = files.filter((f) => isPdf(f) || isImage(f))
  const skipped = files.length - usable.length

  if (!usable.length) {
    if (skipped) st.notify(skipped === 1 ? 'That file isn’t a PDF or an image.' : 'Those files aren’t PDFs or images.', { tone: 'error' })
    return
  }

  st.setBusy(usable.length === 1 ? 'Reading file' : `Reading ${usable.length} files`)
  const problems: string[] = []
  const results = await Promise.all(
    usable.map((f) =>
      readFile(f).catch((e: unknown) => {
        problems.push(describe(f, e))
        return null
      }),
    ),
  )
  st.setBusy(null)

  const sources: Source[] = []
  const pages: Page[] = []
  for (const r of results) {
    if (!r) continue
    sources.push(r.source)
    pages.push(...r.pages)
  }
  if (pages.length) {
    stage(pages.map((p) => p.id))
    st.addPages(sources, pages)
  }

  if (problems.length) {
    st.notify(problems.length === 1 ? problems[0] : `${problems[0]} ${problems.length - 1} more couldn’t be added.`, { tone: 'error' })
  } else if (skipped) {
    st.notify(`Skipped ${skipped} ${skipped === 1 ? 'file that isn’t' : 'files that aren’t'} a PDF or image.`, { tone: 'error' })
  }
}

async function readFile(f: File): Promise<{ source: Source; pages: Page[] }> {
  const id = uid()
  if (isPdf(f)) {
    const bytes = new Uint8Array(await f.arrayBuffer())
    if (isEncrypted(bytes)) throw new LockedError()
    const doc = await openPdf(id, bytes)
    return {
      source: { id, name: stem(f.name), kind: 'pdf', bytes, pageCount: doc.numPages },
      pages: Array.from({ length: doc.numPages }, (_, index) => ({ id: uid(), sourceId: id, index, rotation: 0 })),
    }
  }
  const img = await normalizeImage(f)
  return {
    source: { id, name: stem(f.name), kind: 'image', pageCount: 1, ...img },
    pages: [{ id: uid(), sourceId: id, index: 0, rotation: 0 }],
  }
}

function describe(f: File, e: unknown) {
  if (e instanceof LockedError || (e instanceof Error && e.name === 'PasswordException')) {
    return `${f.name} is password-protected, so it can’t be edited yet.`
  }
  return `Couldn’t read ${f.name}. It may be damaged.`
}

/** Encrypted PDFs carry /Encrypt in their (always uncompressed) trailer. */
function isEncrypted(b: Uint8Array) {
  const needle = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74] // "/Encrypt"
  outer: for (let i = 0; i <= b.length - needle.length; i++) {
    if (b[i] !== 0x2f) continue
    for (let j = 1; j < needle.length; j++) if (b[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

/**
 * PNGs and upright JPEGs are embedded byte-for-byte (lossless, fast).
 * Rotated phone photos (EXIF orientation) and other formats are redrawn upright first.
 */
async function normalizeImage(f: File) {
  const buf = await f.arrayBuffer()
  const jpeg = f.type === 'image/jpeg'
  const png = f.type === 'image/png'

  if (png || (jpeg && jpegOrientation(buf) <= 1)) {
    const bmp = await createImageBitmap(new Blob([buf], { type: f.type }))
    const { width, height } = bmp
    bmp.close()
    return { bytes: new Uint8Array(buf), mime: f.type as 'image/png' | 'image/jpeg', width, height }
  }

  const bmp = await createImageBitmap(new Blob([buf], { type: f.type }), { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  canvas.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  const mime = jpeg ? 'image/jpeg' : 'image/png'
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Encode failed'))), mime, 0.92))
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: mime as 'image/png' | 'image/jpeg', width: canvas.width, height: canvas.height }
}

function jpegOrientation(buf: ArrayBuffer): number {
  try {
    const v = new DataView(buf)
    if (v.getUint16(0) !== 0xffd8) return 1
    let off = 2
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off)
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
        const tiff = off + 10
        const little = v.getUint16(tiff) === 0x4949
        const ifd = tiff + v.getUint32(tiff + 4, little)
        const count = v.getUint16(ifd, little)
        for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12
          if (v.getUint16(entry, little) === 0x0112) return v.getUint16(entry + 8, little)
        }
        return 1
      }
      if ((marker & 0xff00) !== 0xff00) return 1
      off += 2 + v.getUint16(off + 2)
    }
  } catch {
    /* malformed header: treat as upright */
  }
  return 1
}
