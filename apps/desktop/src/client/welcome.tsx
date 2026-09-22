/** Mount the local React renderer before Electron reveals the welcome window. */
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Welcome } from './WelcomePage.tsx'
import type { TFlowWelcomeApi } from '../preload-tflow.ts'

declare global {
  interface Window {
    dshTFlow: TFlowWelcomeApi
  }
}

const container = document.getElementById('root')
if (container === null) throw new Error('desktop welcome: missing React root')
const root = createRoot(container)
flushSync(() => { root.render(<Welcome api={window.dshTFlow} />) })
window.addEventListener('pagehide', () => { root.unmount() }, { once: true })
