import { lazy, Suspense } from 'react'
import { useStore } from './lib/store'
import { useFileDrop, usePaste, useShortcuts } from './lib/hooks'
import { TopBar } from './components/TopBar'
import { EmptyState } from './components/EmptyState'
import { PageGrid } from './components/PageGrid'
import { Toast } from './components/Toast'
import { UpdateBar } from './components/UpdateBar'
import { CompressDialog } from './components/CompressDialog'
import { PasswordDialog } from './components/PasswordDialog'
import { DropOverlay, Dock } from './components/Overlays'
import { usePrefs } from './lib/prefs'

// The tool panels are fetched the first time one is opened, to keep the first screen small.
const Tools = lazy(() => import('./components/tools'))
const Appearance = lazy(() => import('./components/Appearance'))

export default function App() {
  const hasPages = useStore((s) => s.pages.length > 0)
  const tool = useStore((s) => s.tool)
  const appearance = usePrefs((s) => s.open)
  const dragging = useFileDrop()
  useShortcuts()
  usePaste()

  return (
    <>
      <TopBar />
      <main className="overflow-x-clip">{hasPages ? <PageGrid /> : <EmptyState />}</main>
      {hasPages && <Dock />}
      {dragging && <DropOverlay />}
      <CompressDialog />
      <PasswordDialog />
      {tool && (
        <Suspense fallback={null}>
          <Tools />
        </Suspense>
      )}
      {appearance && (
        <Suspense fallback={null}>
          <Appearance />
        </Suspense>
      )}
      <Toast />
      <UpdateBar />
    </>
  )
}
