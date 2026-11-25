// Runs qpdf to lock a PDF. Loaded only when someone protects a file, and the 1.3 MB engine only then.
import createQpdf from '@neslinesli93/qpdf-wasm'
import wasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url'
import { encryptWith, type ProtectOptions, type Qpdf } from './protect'

self.onmessage = async (e: MessageEvent<{ bytes: Uint8Array; options: ProtectOptions; owner: string }>) => {
  try {
    const qpdf = (await (createQpdf as unknown as (o: object) => Promise<Qpdf>)({ locateFile: () => wasmUrl, noInitialRun: true, print: () => {}, printErr: () => {} }))
    const bytes = encryptWith(qpdf, e.data.bytes, e.data.options, e.data.owner).slice() // its own copy, so it can be handed over
    ;(self as unknown as Worker).postMessage({ ok: true, bytes }, [bytes.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
