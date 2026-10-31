// Pure helpers with no browser dependencies, so they're easy to test.

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  const mb = n / 1024 / 1024
  return `${mb < 10 ? Number(mb.toFixed(1)) : Math.round(mb)} MB`
}

/** Reads sizes the way people type them: "300", "300kb", "1.5 MB", "1,000 KB", "2m". */
export function parseSize(input: string): { kb: number } | { error: string } {
  // Drop thousands separators only ("1,000"), and allow a space only before the unit, so "5 5" isn't read as 55.
  const s = input.trim().toLowerCase().replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
  if (!s) return { error: 'Type a size, like 300 KB or 1.5 MB.' }
  const m = s.match(/^(\d+(?:\.\d+)?|\.\d+)\s*(kb|k|mb|m)?$/)
  if (!m) return { error: 'Type a size, like 300 KB or 1.5 MB.' }
  const kb = parseFloat(m[1]) * (m[2]?.startsWith('m') ? 1024 : 1)
  if (kb < 10) return { error: 'That’s smaller than any PDF can be. Try 10 KB or more.' }
  if (kb > 1024 * 1024) return { error: 'That’s bigger than Cornerfold needs. Try a size under 1 GB.' }
  return { kb: Math.round(kb) }
}
