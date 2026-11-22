import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_EVERY_MS, canReloadUnasked, startUpdates, useUpdate } from '../src/lib/updates'
import { useStore, type Page, type Source } from '../src/lib/store'
import type { RegisterOptions } from './stubs/pwaRegister'

const src = (id: string): Source => ({ id, name: id, kind: 'pdf', bytes: new Uint8Array(1), pageCount: 1 })
const page = (id: string): Page => ({ id, sourceId: 'a', index: 0, rotation: 0 })

/** A stand-in for the browser's service worker registration that records what the app asks of it. */
function fake() {
  const reload = vi.fn(async () => {})
  const update = vi.fn(async () => undefined)
  let options: RegisterOptions = {}
  const register = ((o: RegisterOptions) => {
    options = o
    return reload
  }) as never
  return { reload, update, register, options: () => options, registration: { update } as unknown as ServiceWorkerRegistration }
}

beforeEach(() => {
  useStore.setState({ sources: {}, pages: [], selected: new Set(), anchor: null, past: [], future: [] })
  useUpdate.setState({ ready: false })
  vi.restoreAllMocks()
  Object.defineProperty(globalThis, 'document', { value: { addEventListener: vi.fn(), visibilityState: 'visible' }, configurable: true })
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, serviceWorker: { addEventListener: vi.fn() } }, configurable: true })
})

describe('a new version while Cornerfold is open', () => {
  it('only reloads unasked when nothing is open', () => {
    expect(canReloadUnasked(0)).toBe(true)
    expect(canReloadUnasked(1)).toBe(false)
  })

  it('reloads straight away when no files are open, so nobody has to hard-refresh', () => {
    const f = fake()
    startUpdates(f.register)
    f.options().onNeedRefresh?.()
    expect(f.reload).toHaveBeenCalledWith(true)
    expect(useUpdate.getState().ready).toBe(false)
  })

  it('asks first when files are open, and does not reload', () => {
    useStore.getState().addPages([src('a')], [page('p1')])
    const f = fake()
    startUpdates(f.register)
    f.options().onNeedRefresh?.()
    expect(f.reload).not.toHaveBeenCalled()
    expect(useUpdate.getState().ready).toBe(true)
  })

  it('reloads when the person says so, and "later" puts the bar away without reloading', () => {
    useStore.getState().addPages([src('a')], [page('p1')])
    const f = fake()
    startUpdates(f.register)
    f.options().onNeedRefresh?.()
    useUpdate.getState().later()
    expect(useUpdate.getState().ready).toBe(false)
    expect(f.reload).not.toHaveBeenCalled()
    useUpdate.getState().apply()
    expect(f.reload).toHaveBeenCalledWith(true)
  })

  it('checks for a newer version on a timer and when the tab comes back, but not while offline', () => {
    vi.useFakeTimers()
    const f = fake()
    const listeners: Record<string, () => void> = {}
    ;(document as unknown as { addEventListener: (n: string, cb: () => void) => void }).addEventListener = (n, cb) => void (listeners[n] = cb)
    startUpdates(f.register)
    f.options().onRegisteredSW?.('/sw.js', f.registration)
    vi.advanceTimersByTime(CHECK_EVERY_MS)
    expect(f.update).toHaveBeenCalledTimes(1)
    listeners.visibilitychange()
    expect(f.update).toHaveBeenCalledTimes(2)
    ;(navigator as unknown as { onLine: boolean }).onLine = false
    vi.advanceTimersByTime(CHECK_EVERY_MS)
    expect(f.update).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
