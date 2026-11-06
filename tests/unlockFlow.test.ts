// A locked file all the way through: add it, answer the questions, then export, split and compress it.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { PDFDocument } from '@cantoo/pdf-lib'
import { installBrowserImageApis } from './helpers/canvas'
import { textPdf } from './helpers/fixtures'
import { PASSWORD, STATEMENT_TEXT, lockedPdf } from './helpers/lockedSamples'
import { contains } from '../src/lib/bytes'
import { promptOpen, usePrompt } from '../src/lib/passwords'

vi.mock('../src/lib/pdf', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  class EngineError extends Error {}
  return {
    EngineError,
    openPdf: (_id: string, bytes: Uint8Array) => pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise,
    releaseSource: () => {},
  }
})
vi.mock('../src/lib/engine', async () => {
  const { unlockPdf } = await import('../src/lib/unlock')
  return { getWorker: () => {}, runJob: vi.fn(), unlockInWorker: unlockPdf }
})

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const posted: { files?: { name: string; bytes: Uint8Array }[] }[] = []
let ingestFiles: typeof import('../src/lib/ingest').ingestFiles
let useStore: typeof import('../src/lib/store').useStore
let handler: (e: { data: unknown }) => Promise<void>
let job = 0

beforeAll(async () => {
  installBrowserImageApis()
  const g = globalThis as Record<string, unknown>
  g.matchMedia = () => ({ matches: false })
  g.self = { postMessage: (m: never) => posted.push(m) }
  ;({ ingestFiles } = await import('../src/lib/ingest'))
  ;({ useStore } = await import('../src/lib/store'))
  await import('../src/lib/worker')
  handler = (g.self as { onmessage: typeof handler }).onmessage
})
beforeEach(() => useStore.setState({ sources: {}, pages: [], past: [], future: [], toast: null, busy: null }))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Plays the person: answers each question in turn as it appears. */
async function answer(...values: (string | null)[]) {
  for (const value of values) {
    for (let i = 0; i < 400 && !promptOpen(); i++) await sleep(5)
    usePrompt.getState().prompt!.answer(value)
  }
}
const add = (files: { bytes: Uint8Array; name: string }[], ...answers: (string | null)[]) =>
  Promise.all([ingestFiles(files.map((f) => new File([f.bytes], f.name, { type: 'application/pdf' }))), answer(...answers)])

async function run(op: 'merge' | 'split' | 'compress', options?: unknown) {
  // pdf.js (running for real here) replaces the global `self`; put the stand-in the worker talks to back.
  ;(globalThis as Record<string, unknown>).self = { postMessage: (m: never) => posted.push(m) }
  const { sources, pages } = useStore.getState()
  await handler({
    data: {
      id: ++job, op, name: 'out', options,
      sources: Object.values(sources).map((s) => ({ id: s.id, kind: s.kind, pageCount: s.pageCount, bytes: s.bytes.slice() })),
      pages: pages.map(({ sourceId, index, rotation }) => ({ sourceId, index, rotation })),
    },
  })
  return posted[posted.length - 1].files![0]
}
async function readBack(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise
  const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
  const out = { pages: doc.numPages, text, permissions: await doc.getPermissions() }
  await doc.destroy()
  return out
}

describe.each(['aes256', 'aes128', 'rc4_128', 'rc4_40', 'objstm'] as const)('a password-protected PDF (%s), once unlocked', (kind) => {
  it('exports as an ordinary PDF: no password, no restrictions, same pages and text', async () => {
    await add([{ bytes: lockedPdf(kind), name: 'statement.pdf' }], 'wrong first', PASSWORD)
    expect(useStore.getState().pages).toHaveLength(2)
    const exported = await run('merge')
    expect(contains(exported.bytes, '/Encrypt')).toBe(false)
    expect((await PDFDocument.load(exported.bytes)).isEncrypted).toBe(false)
    expect(await readBack(exported.bytes)).toMatchObject({ pages: 2, text: STATEMENT_TEXT, permissions: null })
  })

  it('can be compressed and split like any other file, and the results are unprotected too', async () => {
    await add([{ bytes: lockedPdf(kind), name: 'statement.pdf' }], PASSWORD)
    const compressed = await run('compress', { preset: 'balanced' })
    expect(contains(compressed.bytes, '/Encrypt')).toBe(false)
    expect((await readBack(compressed.bytes)).text).toBe(STATEMENT_TEXT)
    const zip = unzipSync((await run('split')).bytes)
    const parts = Object.values(zip)
    expect(parts).toHaveLength(2)
    for (const part of parts) {
      expect(contains(part, '/Encrypt')).toBe(false)
      expect((await PDFDocument.load(part)).getPageCount()).toBe(1)
    }
  })
})

describe('a restricted file and ordinary files together', () => {
  it('merges an editable copy of a restricted statement with an ordinary PDF', async () => {
    await add([{ bytes: lockedPdf('restricted'), name: 'bank.pdf' }, { bytes: await textPdf(1), name: 'notes.pdf' }], 'yes')
    expect(useStore.getState().pages).toHaveLength(3)
    const exported = await run('merge')
    expect(contains(exported.bytes, '/Encrypt')).toBe(false)
    expect((await readBack(exported.bytes)).pages).toBe(3)
  })

  it('asks about several locked files one at a time', async () => {
    const seen: string[] = []
    const watcher = (async () => {
      for (const reply of [PASSWORD, null]) {
        for (let i = 0; i < 400 && !promptOpen(); i++) await sleep(5)
        seen.push(usePrompt.getState().prompt!.fileName)
        usePrompt.getState().prompt!.answer(reply)
      }
    })()
    await Promise.all([ingestFiles([new File([lockedPdf('aes256')], 'one.pdf', { type: 'application/pdf' }), new File([lockedPdf('aes128')], 'two.pdf', { type: 'application/pdf' })]), watcher])
    expect(seen).toEqual(['one.pdf', 'two.pdf'])
    expect(useStore.getState().pages).toHaveLength(2) // only the first was opened; the second was skipped
  })
})
