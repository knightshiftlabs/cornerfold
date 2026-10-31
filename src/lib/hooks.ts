import { useEffect, useState } from 'react'
import { useStore } from './store'
import { ingestFiles } from './ingest'
import { deleteSelected, exportPdf, pickFiles, rotateTargets } from './actions'

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, [contenteditable="true"]')) return
      const st = useStore.getState()
      if (st.compressOpen) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()

      if (mod && k === 'z') return e.preventDefault(), e.shiftKey ? st.redo() : st.undo()
      if (mod && k === 'y') return e.preventDefault(), st.redo()
      if (mod && k === 'o') return e.preventDefault(), pickFiles()
      if (mod && k === 's') return e.preventDefault(), exportPdf()
      if (mod && k === 'a' && st.pages.length) return e.preventDefault(), st.selectAll()
      if (mod || e.altKey) return

      if (k === 'r') return rotateTargets(e.shiftKey ? -90 : 90)
      if ((k === 'delete' || k === 'backspace') && st.selected.size) return e.preventDefault(), deleteSelected()
      if (k === 'escape') return st.deselect()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Files can be dropped anywhere on the window. */
export function useFileDrop() {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    const dragover = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setOver(false)
      if (useStore.getState().compressOpen) return
      ingestFiles([...e.dataTransfer!.files])
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', dragover)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', dragover)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return over
}

/** Paste a screenshot or copied file straight onto the desk. */
export function usePaste() {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])]
      if (!files.length || useStore.getState().compressOpen) return
      e.preventDefault()
      ingestFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
}
