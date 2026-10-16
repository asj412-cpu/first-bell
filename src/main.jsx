import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { BellProvider } from './lib/store.jsx'
import { VaultProvider } from './lib/vault/VaultProvider.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <BellProvider>
        <VaultProvider>
          <App />
        </VaultProvider>
      </BellProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
