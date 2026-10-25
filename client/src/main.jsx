import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './installPromptStore'
import './index.css'
import App from './App.jsx'
import About from './About.jsx'
import SharedDeck from './SharedDeck.jsx'

const path = window.location.pathname
const shareMatch = path.match(/^\/s\/([\w-]+)\/?$/)

let page = <App />
if (path === '/about') page = <About />
else if (shareMatch) page = <SharedDeck token={shareMatch[1]} />

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {page}
  </StrictMode>,
)
