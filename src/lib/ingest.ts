import { useStore, type Page, type Source } from './store'
import { EngineError, openPdf, releaseSource } from './pdf'
import { contains } from './bytes'
import { stage } from './motion'
import { getWorker } from './engine'
import { stripJpegMetadata } from './jpeg'

const uid = () => crypto.randomUUID()
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const isImage = (f: File) => f.type.startsWith('image/')
const stem = (name: string) => name.replace(/\.[^.]+$/, '') || 'file'

class PasswordError extends Error {}
class RestrictedError extends Error {}
class EmptyError extends Error {}
class UnsupportedImageError extends Error {
  constructor(readonly heic: boolean) {
    super()
  }
}
const isHeic = (f: File) => /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name)

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
  const signed: string[] = []
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
    if (r.signed) signed.push(r.fileName)
  }
  if (pages.length) {
    stage(pages.map((p) => p.id))
    st.addPages(sources, pages)
    getWorker() // normally already running; started at load
  }

  if (problems.length) {
    st.notify(problems.length === 1 ? problems[0] : `${problems[0]} ${problems.length - 1} more couldn’t be added.`, { tone: 'error' })
  } else if (signed.length) {
    st.notify(
      `${signed.length === 1 ? `${signed[0]} is` : `${signed.length} of these files are`} digitally signed. Any change, even compressing, will make the signature invalid, though the pages will look the same.`,
      { tone: 'error' },
    )
  } else if (skipped) {
    st.notify(`Skipped ${skipped} ${skipped === 1 ? 'file that isn’t' : 'files that aren’t'} a PDF or image.`, { tone: 'error' })
  }
}

async function readFile(f: File): Promise<{ source: Source; pages: Page[]; signed: boolean; fileName: string }> {
  const id = uid()
  if (!f.size) throw new EmptyError()
  if (isPdf(f)) {
    const bytes = new Uint8Array(await f.arrayBuffer())
    if (contains(bytes, '/Encrypt')) {
      // Encrypted PDFs: either a password is needed to open them, or they open freely but
      // carry editing restrictions (common for bank statements). Neither can be edited yet.
      let opened = false
      try {
        await openPdf(id, bytes)
        opened = true
      } catch (e) {
        if (e instanceof Error && e.name === 'PasswordException') throw new PasswordError()
        throw e
      } finally {
        releaseSource(id)
      }
      if (opened) throw new RestrictedError()
    }
    const doc = await openPdf(id, bytes)
    return {
      source: { id, name: stem(f.name), kind: 'pdf', bytes, pageCount: doc.numPages },
      pages: Array.from({ length: doc.numPages }, (_, index) => ({ id: uid(), sourceId: id, index, rotation: 0 })),
      signed: contains(bytes, '/ByteRange'), // every digital signature records the byte range it covers
      fileName: f.name,
    }
  }
  let img
  try {
    img = await normalizeImage(f)
  } catch {
    throw new UnsupportedImageError(isHeic(f))
  }
  return {
    source: { id, name: stem(f.name), kind: 'image', pageCount: 1, ...img },
    pages: [{ id: uid(), sourceId: id, index: 0, rotation: 0 }],
    signed: false,
    fileName: f.name,
  }
}

function describe(f: File, e: unknown) {
  if (e instanceof EmptyError) return `${f.name} is empty.`
  if (e instanceof PasswordError) return `${f.name} needs a password to open. Remove the password in the app that made it, then try again.`
  if (e instanceof RestrictedError)
    return `${f.name} has editing restrictions set by whoever made it, which is common for bank statements. Cornerfold can’t edit restricted PDFs yet.`
  if (e instanceof UnsupportedImageError)
    return e.heic
      ? `${f.name} is an iPhone photo (HEIC), which this browser can’t open. Share it as a JPEG instead, or set your iPhone camera to “Most Compatible”.`
      : `${f.name} is in an image format this browser can’t open. Try a JPEG or PNG.`
  if (e instanceof EngineError) return 'Cornerfold was updated while this tab was open. Reload the page, then add your files again.'
  return `Couldn’t read ${f.name}. It may be damaged, or it may not really be a PDF.`
}


/**
 * PNGs go in as they are (the PDF writer keeps only their pixels). An upright JPEG goes in without being
 * re-encoded, but first loses the hidden details a photo carries: camera, date, GPS location, previews and
 * comments. Rotated phone photos (EXIF orientation), JPEGs that can't be cleaned that way, and other formats
 * are redrawn upright, which drops those details too.
 */
async function normalizeImage(f: File) {
  const buf = await f.arrayBuffer()
  const jpeg = f.type === 'image/jpeg'
  const png = f.type === 'image/png'
  const cleaned = jpeg ? stripJpegMetadata(new Uint8Array(buf)) : null

  if (png || (cleaned && jpegOrientation(buf) <= 1)) {
    const bmp = await createImageBitmap(new Blob([buf], { type: f.type }))
    const { width, height } = bmp
    bmp.close()
    return { bytes: cleaned ?? new Uint8Array(buf), mime: f.type as 'image/png' | 'image/jpeg', width, height }
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

export function jpegOrientation(buf: ArrayBuffer): number {
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
