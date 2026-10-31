/** Byte search for an ASCII marker, without decoding the whole file as text. */
export function contains(b: Uint8Array, marker: string) {
  const needle = [...marker].map((c) => c.charCodeAt(0))
  const first = needle[0]
  outer: for (let i = 0; i <= b.length - needle.length; i++) {
    if (b[i] !== first) continue
    for (let j = 1; j < needle.length; j++) if (b[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}
