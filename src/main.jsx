import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const rootEl = document.getElementById('root')

// Prerendered pages (scripts/prerender.mjs) ship real markup in #root so
// crawlers and "View Source" see full content + per-route meta, and users get
// a fast first paint. We then render fresh over that markup with createRoot
// rather than hydrateRoot: this app's animated counters/values differ between
// prerender time and load time, which would trip hydration-mismatch errors.
// createRoot replaces the static markup with a guaranteed-correct client render
// in a single commit (no blank frame; no hydration-mismatch errors).
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
