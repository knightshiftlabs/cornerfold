import { useStore } from './store'
import { runJob } from './engine'
import { ingestFiles } from './ingest'

/** Actions apply to the selection, or to everything when nothing is selected. */
export function targets() {
  const { pages, selected } = useStore.getState()
  return selected.size ? pages.filter((p) => selected.has(p.id)) : pages
}

export function baseName(pageList: { sourceId: string }[]) {
  const { sources } = useStore.getState()
  const ids = new Set(pageList.map((p) => p.sourceId))
  return ids.size === 1 ? sources[[...ids][0]].name : 'merged'
}

export function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

const message = (e: unknown) => {
  const text = e instanceof Error ? e.message : String(e)
  // The PDF engine's parser errors are unreadable; translate the common case.
  if (/parse|invalid object|xref/i.test(text)) return 'one of the files is damaged in a way Cornerfold can’t repair.'
  return text
}

export async function exportPdf() {
  const st = useStore.getState()
  const list = targets()
  if (st.busy || !list.length) return
  const base = baseName(list)
  const name = base === 'merged' ? 'merged.pdf' : `${base}-edited.pdf`
  st.setBusy('Exporting')
  try {
    const [file] = (await runJob('merge', list, name)).files
    download(file.bytes, file.name, 'application/pdf')
    st.notify(`Exported ${file.name}`)
  } catch (e) {
    st.notify(`Export failed: ${message(e)}`, { tone: 'error' })
  } finally {
    st.setBusy(null)
  }
}

export async function splitPages() {
  const st = useStore.getState()
  const list = targets()
  if (st.busy || !list.length) return
  if (list.length === 1) return exportPdf()
  st.setBusy('Splitting')
  try {
    const [file] = (await runJob('split', list, baseName(list))).files
    download(file.bytes, file.name, 'application/zip')
    st.notify(`Split into ${list.length} PDFs`)
  } catch (e) {
    st.notify(`Split failed: ${message(e)}`, { tone: 'error' })
  } finally {
    st.setBusy(null)
  }
}

export function deletePages(ids: Set<string>) {
  const st = useStore.getState()
  if (!ids.size) return
  st.remove(ids)
  st.notify(`Deleted ${ids.size} ${ids.size === 1 ? 'page' : 'pages'}`, {
    action: { label: 'Undo', run: () => useStore.getState().undo() },
  })
}

export const deleteSelected = () => deletePages(new Set(useStore.getState().selected))

export function rotateTargets(delta: number) {
  const st = useStore.getState()
  st.rotate(st.selected.size ? st.selected : new Set(st.pages.map((p) => p.id)), delta)
}

export function pickFiles() {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = 'application/pdf,.pdf,image/*'
  input.onchange = () => input.files && ingestFiles([...input.files])
  input.click()
}

export const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
export const MOD = isMac ? '⌘' : 'Ctrl'

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  const mb = n / 1024 / 1024
  return `${mb < 10 ? Number(mb.toFixed(1)) : Math.round(mb)} MB`
}

/** Reads sizes the way people type them: "300", "300kb", "1.5 MB", "1,000 KB", "2m". */
export function parseSize(input: string): { kb: number } | { error: string } {
  const s = input.trim().toLowerCase().replace(/[,\s]/g, '')
  if (!s) return { error: 'Type a size, like 300 KB or 1.5 MB.' }
  const m = s.match(/^(\d+(?:\.\d+)?|\.\d+)(kb|k|mb|m)?$/)
  if (!m) return { error: 'Type a size, like 300 KB or 1.5 MB.' }
  const kb = parseFloat(m[1]) * (m[2]?.startsWith('m') ? 1024 : 1)
  if (kb < 10) return { error: 'That’s smaller than any PDF can be. Try 10 KB or more.' }
  if (kb > 1024 * 1024) return { error: 'That’s bigger than Cornerfold needs. Try a size under 1 GB.' }
  return { kb: Math.round(kb) }
}
