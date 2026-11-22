import { create } from 'zustand'
import { registerSW } from 'virtual:pwa-register'
import { useStore } from './store'

/**
 * Getting a new version to the person who has Cornerfold open. The site keeps a copy of itself in the browser
 * so it works offline; that copy is replaced in the background when a new version is deployed, but the page already
 * on screen keeps running the old code until it is reloaded. So: when a new version is ready, reload at once if
 * nothing would be lost, and otherwise ask, because files only live in the open tab and a reload closes them.
 */
interface UpdateState {
  /** A new version is ready and waiting for the person to say when. */
  ready: boolean
  /** Reloads into the new version. */
  apply: () => void
  later: () => void
}

export const useUpdate = create<UpdateState>((set) => ({ ready: false, apply: () => {}, later: () => set({ ready: false }) }))

/**
 * Reloading closes whatever is open, so it is only done unasked when nothing is. No pages on screen is not enough:
 * pages that were all deleted can still be brought back with Undo, and that history, along with the files behind it,
 * is gone after a reload. Work in progress counts too.
 */
export const holdsWork = (s: { pages: unknown[]; past: unknown[]; future: unknown[]; busy: string | null }) =>
  s.pages.length > 0 || s.past.length > 0 || s.future.length > 0 || s.busy !== null
export const canReloadUnasked = (s: Parameters<typeof holdsWork>[0]) => !holdsWork(s)

/** How often a tab left open is asked whether there is a newer version. */
export const CHECK_EVERY_MS = 30 * 60_000

export function startUpdates(register: typeof registerSW = registerSW) {
  // The plugin reloads once the new version takes over, but only for a page that began under an older version.
  // A tab opened at the very moment of a first install would otherwise stay on old code, so this does it as well.
  let reloading = false
  const take = () => {
    navigator.serviceWorker?.addEventListener(
      'controllerchange',
      () => {
        if (reloading) return
        reloading = true
        location.reload()
      },
      { once: true },
    )
    void reload(true)
  }
  // A new version that has been found but not yet taken. "Later" only hides the bar; it stays waiting, and is
  // looked at again whenever the files change: reloaded as soon as nothing is left to lose, or offered again once
  // every page has been closed (what remains is only Undo history, which is the person's call).
  let waiting = false
  const unwatch = useStore.subscribe((s) => {
    if (!waiting) return
    if (canReloadUnasked(s)) {
      waiting = false
      unwatch()
      take()
    } else if (s.pages.length === 0 && !useUpdate.getState().ready && s.busy === null) {
      useUpdate.setState({ ready: true })
    }
  })
  const reload = register({
    immediate: true,
    onNeedRefresh() {
      if (canReloadUnasked(useStore.getState())) take()
      else {
        waiting = true
        useUpdate.setState({ ready: true })
      }
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (navigator.onLine) registration.update().catch(() => {})
      }
      setInterval(check, CHECK_EVERY_MS)
      // Coming back to a tab that sat in the background is the moment a new version is most likely to be waiting.
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
    },
  })
  useUpdate.setState({ apply: take })
  return unwatch
}
