// Locking a PDF with a password, on this device. The encryption is done by qpdf (the same program many servers use),
// compiled to WebAssembly and loaded only when someone protects a file. This file holds the parts that do not
// need the browser, so tests can run them against the real qpdf; protect.worker.ts runs them in a worker.

/** What to lock the file against. The password is needed to open it; the rest are requests to the reader. */
export interface ProtectOptions {
  password: string
  /** Ask readers not to allow these. They are a request, not a lock: see the note in the Protect panel. */
  blockPrinting?: boolean
  blockCopying?: boolean
  blockEditing?: boolean
}

/** The part of qpdf's WebAssembly module that is used. */
export interface Qpdf {
  FS: { writeFile: (path: string, data: Uint8Array) => void; readFile: (path: string) => Uint8Array; unlink: (path: string) => void }
  callMain: (args: string[]) => number
}

/** A password only the program knows, to stand as the "owner" password: the one that would allow changing the restrictions. */
export function randomOwnerPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * qpdf's arguments for AES-256 encryption. Passwords go in as `--name=value`, which takes anything as it is: a password
 * that starts with a dash, or looks like a file name, would be mistaken for an option in the plain positional form.
 */
export function protectArgs(opts: ProtectOptions, owner: string, input: string, output: string) {
  if (!opts.password) throw new Error('Choose a password first.')
  return [
    '--encrypt',
    `--user-password=${opts.password}`,
    `--owner-password=${owner}`,
    '--bits=256',
    ...(opts.blockPrinting ? ['--print=none'] : []),
    ...(opts.blockCopying ? ['--extract=n'] : []),
    ...(opts.blockEditing ? ['--modify=none'] : []),
    '--',
    input,
    output,
  ]
}

/** Encrypts the PDF `bytes` with a qpdf module that was made with `noInitialRun`. */
export function encryptWith(qpdf: Qpdf, bytes: Uint8Array, opts: ProtectOptions, owner = randomOwnerPassword()): Uint8Array {
  qpdf.FS.writeFile('/input.pdf', bytes)
  try {
    // 0 is success; 3 means it worked with warnings, which for a PDF that Cornerfold itself just wrote is not a problem.
    const code = qpdf.callMain(protectArgs(opts, owner, '/input.pdf', '/output.pdf'))
    if (code !== 0 && code !== 3) throw new Error('The file could not be locked.')
    return qpdf.FS.readFile('/output.pdf')
  } finally {
    for (const f of ['/input.pdf', '/output.pdf']) {
      try {
        qpdf.FS.unlink(f)
      } catch {
        /* never written */
      }
    }
  }
}

/** Locks a PDF in a worker. A fresh worker each time, ended afterwards, so the engine's memory is given back. */
export function protectPdf(bytes: Uint8Array, opts: ProtectOptions): Promise<Uint8Array> {
  const worker = new Worker(new URL('./protect.worker.ts', import.meta.url), { type: 'module' })
  const copy = bytes.slice()
  return new Promise((resolve, reject) => {
    const done = () => worker.terminate()
    worker.onmessage = (e: MessageEvent<{ ok: boolean; bytes?: Uint8Array; error?: string }>) => {
      done()
      if (e.data.ok && e.data.bytes) resolve(e.data.bytes)
      else reject(new Error(e.data.error || 'The file could not be locked.'))
    }
    worker.onerror = () => {
      done()
      reject(new Error('The locking engine could not start. Reload the page and try again.'))
    }
    worker.postMessage({ bytes: copy, options: opts, owner: randomOwnerPassword() }, [copy.buffer])
  })
}
