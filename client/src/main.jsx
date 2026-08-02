import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './installPromptStore'
import './index.css'
import App from './App.jsx'
import About from './About.jsx'

const isAbout = window.location.pathname === '/about'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isAbout ? <About /> : <App />}
  </StrictMode>,
)
