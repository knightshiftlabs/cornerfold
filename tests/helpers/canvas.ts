// Stand-ins for the browser image APIs the export worker uses, backed by a Node canvas.
import { createCanvas, loadImage, ImageData, type Canvas, type Image } from '@napi-rs/canvas'
import type { Codec } from '../../src/lib/compress'

type Bitmap = Canvas | Image

export const nodeCodec: Codec<Bitmap> = {
  decodeJpeg: async (bytes) => loadImage(Buffer.from(bytes)),
  fromRGBA: async (rgba, w, h) => {
    const c = createCanvas(w, h)
    c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0)
    return c
  },
  encodeJpeg: async (src, w, h, q) => {
    const c = createCanvas(w, h)
    c.getContext('2d').drawImage(src, 0, 0, w, h)
    return new Uint8Array(await c.encode('jpeg', Math.round(q * 100)))
  },
}

// Browser ImageBitmaps have close(); the Node stand-ins don't, so add a no-op one.
const withClose = <T extends object>(o: T) => Object.assign(o, { close() {} })

/** Install browser globals the worker expects: createImageBitmap, OffscreenCanvas, ImageData. */
export function installBrowserImageApis() {
  const g = globalThis as Record<string, unknown>
  g.ImageData = ImageData
  g.createImageBitmap = async (src: Blob | ImageData) => {
    if (src instanceof Blob) {
      const bytes = Buffer.from(await src.arrayBuffer())
      // Like a browser, reject what isn't a decodable image. (The Node canvas library crashes on
      // garbage instead of rejecting, so check the signature first.) Only PNG and JPEG are
      // decoded here; browsers also handle WebP, GIF and, in Safari, HEIC.
      const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      const jpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      if (!png && !jpeg) throw new DOMException('The source image could not be decoded.', 'InvalidStateError')
      return withClose(await loadImage(bytes))
    }
    const c = createCanvas(src.width, src.height)
    c.getContext('2d').putImageData(src as ImageData, 0, 0)
    return withClose(c)
  }
  g.OffscreenCanvas = class {
    c: Canvas
    constructor(w: number, h: number) {
      this.c = createCanvas(w, h)
    }
    getContext() {
      return this.c.getContext('2d')
    }
    async convertToBlob({ quality }: { quality: number }) {
      return new Blob([await this.c.encode('jpeg', Math.round(quality * 100))])
    }
  }
}
