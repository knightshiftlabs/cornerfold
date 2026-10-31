import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import './index.css'
import App from './App'
import { loadPdfEngine, releaseSource } from './lib/pdf'
import { forgetSources, getWorker } from './lib/engine'
import { onRelease, useStore } from './lib/store'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Free memory for files that no page or undo step uses any more.
onRelease((ids) => {
  ids.forEach(releaseSource)
  forgetSources(ids)
})

// Start both PDF engines once the page is idle. The first drop then feels instant, and the
// engines are already in memory if a new version is deployed while this tab stays open.
const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1200))
idle(() => {
  loadPdfEngine().catch(() => {})
  getWorker()
})

// If a newer deploy replaced code this tab still needs, say so plainly instead of failing quietly.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  useStore.getState().notify('Cornerfold was updated while this tab was open. Reload to keep going.', {
    tone: 'error',
    action: { label: 'Reload', run: () => location.reload() },
  })
})
