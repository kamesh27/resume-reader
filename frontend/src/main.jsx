import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
// We don't have a separate index.css in this setup, App.css handles styles
// import './index.css' 

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
