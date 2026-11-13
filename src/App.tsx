import { lazy, Suspense } from 'react'
import { useStore } from './lib/store'
import { useFileDrop, usePaste, useShortcuts } from './lib/hooks'
import { TopBar } from './components/TopBar'
import { EmptyState } from './components/EmptyState'
import { PageGrid } from './components/PageGrid'
import { Toast } from './components/Toast'
import { CompressDialog } from './components/CompressDialog'
import { PasswordDialog } from './components/PasswordDialog'
import { DropOverlay, Hints } from './components/Overlays'

// The tool panels are fetched the first time one is opened, to keep the first screen small.
const Tools = lazy(() => import('./components/tools'))

export default function App() {
  const hasPages = useStore((s) => s.pages.length > 0)
  const tool = useStore((s) => s.tool)
  const dragging = useFileDrop()
  useShortcuts()
  usePaste()

  return (
    <>
      <TopBar />
      <main>{hasPages ? <PageGrid /> : <EmptyState />}</main>
      {hasPages && <Hints />}
      {dragging && <DropOverlay />}
      <CompressDialog />
      <PasswordDialog />
      {tool && (
        <Suspense fallback={null}>
          <Tools />
        </Suspense>
      )}
      <Toast />
    </>
  )
}
