import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// Guard against the entry module executing more than once (seen with
// electron-vite dev double-loading). A second createRoot() on the same
// container detaches the container from the first React instance, which
// silently kills ALL onClick handlers in the visible tree.
const container = document.getElementById('root')! as HTMLElement & { __hidockRootCreated?: boolean }
console.log('[main.tsx] executing; rootAlreadyCreated =', !!container.__hidockRootCreated)

if (!container.__hidockRootCreated) {
  container.__hidockRootCreated = true
  ReactDOM.createRoot(container).render(
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </HashRouter>
  )
}
