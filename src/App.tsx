import { useStore } from './lib/store'
import { useFileDrop, usePaste, useShortcuts } from './lib/hooks'
import { TopBar } from './components/TopBar'
import { EmptyState } from './components/EmptyState'
import { PageGrid } from './components/PageGrid'
import { Toast } from './components/Toast'
import { DropOverlay, Hints } from './components/Overlays'

export default function App() {
  const hasPages = useStore((s) => s.pages.length > 0)
  const dragging = useFileDrop()
  useShortcuts()
  usePaste()

  return (
    <>
      <TopBar />
      <main>{hasPages ? <PageGrid /> : <EmptyState />}</main>
      {hasPages && <Hints />}
      {dragging && <DropOverlay />}
      <Toast />
    </>
  )
}
