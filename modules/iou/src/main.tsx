import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './application/App'
import './styles.css'
import './ui/theme.css'
import './ui/layout.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
