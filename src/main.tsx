import React from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import 'vditor/dist/index.css'
import './styles.css'
import { lazy, Suspense } from 'react'
import App from './App'

const Diagnostics = lazy(() => import('./Diagnostics'))
const diagnostics = new URLSearchParams(window.location.search).has('diagnostics')

createRoot(document.getElementById('root')!).render(<React.StrictMode>{diagnostics ? <Suspense fallback={null}><Diagnostics /></Suspense> : <App />}</React.StrictMode>)
