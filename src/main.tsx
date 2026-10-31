import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import './index.css'
import App from './App'
import { loadPdfEngine } from './lib/pdf'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Warm up the PDF engine once the page is idle so the first drop feels instant.
const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1200))
idle(() => void loadPdfEngine())