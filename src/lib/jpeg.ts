// Photos carry hidden details: the phone or camera model, the date and time, very often the GPS location,
// a preview picture, editing history, comments. This removes all of that from a JPEG file without touching
// the picture itself: nothing is decoded or re-encoded, so the image data stays bit-for-bit identical.

const startsWith = (b: Uint8Array, at: number, text: string) => {
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false
  return true
}

/**
 * Whether a segment must stay for the picture to display correctly. Kept: the JFIF header, the colour
 * profile, Adobe's marker (it says how CMYK colours are stored) and everything structural. Dropped: EXIF and
 * XMP (camera, date, GPS, previews), IPTC/Photoshop data, other application data, and comments.
 */
function keep(marker: number, b: Uint8Array, payload: number) {
  if (marker === 0xe0) return startsWith(b, payload, 'JFIF\0') // not the JFXX extension, which can hold a preview
  if (marker === 0xe2) return startsWith(b, payload, 'ICC_PROFILE\0')
  if (marker === 0xee) return startsWith(b, payload, 'Adobe')
  if (marker === 0xfe) return false // comment
  if (marker >= 0xe1 && marker <= 0xef) return false // APP1 (EXIF, XMP), APP13 (IPTC) and the rest
  return true
}

/**
 * Returns the JPEG without its hidden details, or null if the file isn't one this can read with certainty
 * (the caller then redraws the picture instead, which removes them too). Anything after the end of the
 * image, where some phones append extra pictures or video, is dropped as well. A file that was cut off
 * inside its picture data (an interrupted download) is closed properly and kept.
 */
export function stripJpegMetadata(input: Uint8Array): Uint8Array | null {
  const n = input.length
  if (n < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null
  const out: Uint8Array[] = [input.subarray(0, 2)]
  let sawFrame = false
  let i = 2

  const finish = () => {
    if (!sawFrame) return null
    const result = new Uint8Array(out.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of out) {
      result.set(part, at)
      at += part.length
    }
    return result
  }

  while (i < n) {
    if (input[i] !== 0xff) return null
    while (i < n && input[i] === 0xff) i++ // fill bytes
    if (i >= n) return null
    const marker = input[i++]
    const start = i - 2

    if (marker === 0xd9) {
      out.push(Uint8Array.of(0xff, 0xd9))
      return finish()
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(input.subarray(start, i)) // markers with no length
      continue
    }
    if (marker === 0x00 || marker === 0xd8) return null
    if (i + 2 > n) return null
    const length = (input[i] << 8) | input[i + 1]
    if (length < 2 || i + length > n) return null

    if (marker === 0xda) {
      // Start of scan: the header, then the compressed picture data up to the next real marker.
      out.push(input.subarray(start, i + length))
      i += length
      const dataStart = i
      while (i < n) {
        if (input[i] === 0xff) {
          if (i + 1 >= n) break
          const next = input[i + 1]
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            i += 2
            continue
          }
          if (next === 0xff) {
            i++
            continue
          }
          break
        }
        i++
      }
      out.push(input.subarray(dataStart, i))
      if (i >= n) {
        out.push(Uint8Array.of(0xff, 0xd9)) // cut off inside the picture data: close it
        return finish()
      }
      continue
    }

    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) sawFrame = true
    if (keep(marker, input, i + 2)) out.push(input.subarray(start, i + length))
    i += length
  }
  return null
}
