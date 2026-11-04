// Fuzzing: thousands of randomly corrupted PDFs through the same PDF engines the app uses.
// Rejecting a broken file is fine. Hanging, crashing, or turning an accepted file into a broken
// export is not. Failing inputs are saved to tests/fuzz/failures/ so they can be replayed.
import { beforeAll, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { installBrowserImageApis } from '../helpers/canvas'
import { annotatedPdf, formPdf, inheritedRotationPdf, mixedSizesPdf, textPdf } from '../helpers/fixtures'
import { createCanvas } from '@napi-rs/canvas'

const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 400)
const SEED = Number(process.env.FUZZ_SEED ?? Math.floor(Math.random() * 2 ** 31))
const STEP_TIMEOUT = 15_000

// Small, fast, reproducible random numbers (mulberry32).
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TOKENS = ['obj', 'endobj', '<<', '>>', '[', ']', 'stream', 'endstream', '/Length 0', '/Length 99999999', '-1', '99999999999', '0 0 R', '9999 0 R', '/Filter /FlateDecode', '/Kids [', 'trailer', 'xref', '%%EOF', '/Type /Page', '(', ')', '\\', '/ObjStm']

function mutate(src: Uint8Array, r: () => number) {
  let b = src.slice()
  const pick = (n: number) => Math.floor(r() * n)
  for (let k = 0, n = 1 + pick(4); k < n; k++) {
    const at = pick(b.length)
    switch (pick(6)) {
      case 0: // flip a few bytes
        for (let i = 0, m = 1 + pick(20); i < m; i++) b[pick(b.length)] = pick(256)
        break
      case 1: { // insert a PDF token
        const t = new TextEncoder().encode(` ${TOKENS[pick(TOKENS.length)]} `)
        b = new Uint8Array([...b.subarray(0, at), ...t, ...b.subarray(at)])
        break
      }
      case 2: // delete a chunk
        b = new Uint8Array([...b.subarray(0, at), ...b.subarray(Math.min(b.length, at + 1 + pick(200)))])
        break
      case 3: { // duplicate a chunk
        const chunk = b.subarray(at, Math.min(b.length, at + 1 + pick(400)))
        b = new Uint8Array([...b.subarray(0, at), ...chunk, ...b.subarray(at)])
        break
      }
      case 4: // truncate
        b = b.subarray(0, Math.max(1, at))
        break
      default: { // replace a number with an extreme one
        const s = new TextDecoder('latin1').decode(b)
        const nums = [...s.matchAll(/\b\d{1,6}\b/g)]
        if (!nums.length) break
        const m = nums[pick(nums.length)]
        const repl = ['0', '-1', '2147483648', '99999999999', '1e308', 'NaN'][pick(6)]
        b = new TextEncoder().encode(s.slice(0, m.index) + repl + s.slice(m.index! + m[0].length))
      }
    }
  }
  return b
}

const within = <T>(p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('HANG')), STEP_TIMEOUT))])

let pdfjs: typeof import('pdfjs-dist')
let handler: (e: { data: unknown }) => Promise<void>
const received: { ok: boolean; error?: string; files?: { bytes: Uint8Array }[] }[] = []
const seeds: Uint8Array[] = []

beforeAll(async () => {
  installBrowserImageApis()
  // Load pdf.js first: it replaces the global `self`, which the export engine uses to reply.
  pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as typeof import('pdfjs-dist')
  ;(globalThis as Record<string, unknown>).self = { postMessage: (m: never) => received.push(m) }
  await import('../../src/lib/worker')
  handler = (globalThis as unknown as { self: { onmessage: typeof handler } }).self.onmessage
  // A small image PDF, so image paths in compression get fuzzed too.
  const img = await PDFDocument.create()
  const c = createCanvas(700, 900)
  const x = c.getContext('2d')
  for (let k = 0; k < 400; k++) {
    x.fillStyle = `hsl(${k % 360},50%,50%)`
    x.fillRect((k * 37) % 700, (k * 53) % 900, 40, 40)
  }
  img.addPage([595, 842]).drawImage(await img.embedJpg(await c.encode('jpeg', 90)), { x: 0, y: 0, width: 595, height: 842 })
  seeds.push(await textPdf(2), await formPdf(), await annotatedPdf(), await mixedSizesPdf(), await inheritedRotationPdf(), await img.save(), await img.save({ useObjectStreams: false }))
})

it(`survives ${ITERATIONS} corrupted PDFs (seed ${SEED})`, async () => {
  const r = rng(SEED)
  // pdf.js occasionally leaves an internal promise unhandled after rejecting a corrupt file. In a
  // browser that's a console message with no effect on the app, so count these rather than fail.
  let pdfjsUnhandled = 0
  process.on('unhandledRejection', () => pdfjsUnhandled++)
  const tally = { pdfjsOpened: 0, pdfjsRejected: 0, pdflibLoaded: 0, pdflibRejected: 0, exported: 0, exportRejected: 0 }
  const failures: string[] = []
  const fail = (i: number, input: Uint8Array, why: string) => {
    mkdirSync('tests/fuzz/failures', { recursive: true })
    const file = `tests/fuzz/failures/seed${SEED}-case${i}.pdf`
    writeFileSync(file, input)
    failures.push(`case ${i}: ${why} (saved to ${file})`)
  }

  for (let i = 0; i < ITERATIONS; i++) {
    const input = mutate(seeds[i % seeds.length], r)
    // If the process dies, this shows which input did it.
    if (process.env.FUZZ_TRACE) {
      mkdirSync('tests/fuzz/failures', { recursive: true })
      writeFileSync('tests/fuzz/failures/last-case.pdf', input)
      writeFileSync('tests/fuzz/failures/last-case.txt', `seed ${SEED} case ${i}`)
    }
    // 1. The engine that reads files when they're added, and draws thumbnails.
    let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']> | undefined
    try {
      doc = await within(pdfjs.getDocument({ data: input.slice(), isEvalSupported: false, verbosity: 0 }).promise)
      const page = await within(doc.getPage(1))
      await within(page.getOperatorList())
      await within(page.getTextContent())
      tally.pdfjsOpened++
    } catch (e) {
      if ((e as Error).message === 'HANG') fail(i, input, 'pdf.js hung')
      tally.pdfjsRejected++
    } finally {
      await doc?.destroy().catch(() => {})
    }
    // 2. The engine that builds exports and compresses.
    let pages = 0
    try {
      pages = (await within(PDFDocument.load(input, { updateMetadata: false }))).getPageCount()
      tally.pdflibLoaded++
    } catch (e) {
      if ((e as Error).message === 'HANG') fail(i, input, 'pdf-lib hung while loading')
      tally.pdflibRejected++
      continue
    }
    if (!pages) continue
    // 3. Cornerfold's own export and compression, exactly as the app runs them.
    for (const [op, options] of [['merge', undefined], ['compress', { preset: 'smallest' }]] as const) {
      received.length = 0
      const id = `${SEED}-${i}-${op}`
      // pdf.js swaps the global `self` when it opens files; give the engine its reply channel back.
      const g = globalThis as Record<string, unknown>
      const pdfjsSelf = g.self
      g.self = { postMessage: (msg: never) => received.push(msg) }
      try {
        await within(handler({ data: { id: 1, op, name: 'x', options, sources: [{ id, kind: 'pdf', pageCount: pages, bytes: input }], pages: Array.from({ length: Math.min(pages, 50) }, (_, index) => ({ sourceId: id, index, rotation: 0 })) } }))
      } catch (e) {
        g.self = pdfjsSelf
        fail(i, input, `export engine ${(e as Error).message === 'HANG' ? 'hung' : `threw instead of reporting an error (${(e as Error).message})`} during ${op}`)
        continue
      }
      await handler({ data: { op: 'forget', ids: [id] } })
      g.self = pdfjsSelf
      const m = received[0]
      if (!m) fail(i, input, `export engine sent no reply during ${op}`)
      else if (!m.ok) tally.exportRejected++
      else {
        tally.exported++
        // Anything we accepted and exported must itself be a valid PDF.
        try {
          await within(PDFDocument.load(m.files![0].bytes, { updateMetadata: false }))
        } catch {
          fail(i, input, `${op} produced a broken PDF from an accepted file`)
        }
      }
    }
  }
  console.log(`fuzz seed ${SEED}:`, JSON.stringify({ ...tally, pdfjsUnhandledInternalErrors: pdfjsUnhandled }))
  expect(failures).toEqual([])
})
